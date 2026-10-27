import { prisma } from './prisma.js';

export async function acceptPersistedInvoice(uploadId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM portal_administrativo.uploads_pdf WHERE id=${uploadId}::uuid FOR UPDATE`;
    const upload=await tx.uploadPdf.findUnique({where:{id:uploadId}});
    if(!upload || upload.documentType!=='nota_fiscal' || ['removido','substituido'].includes(upload.status) || !upload.motoristaId || !upload.periodoPagamentoId || !upload.basePagamentoId) {
      throw new Error('Nota fiscal sem arquivo e vínculo completo no Administrativo.');
    }
    const existing=await tx.driverPdfReceived.findFirst({where:{uploadPdfId:upload.id,documentType:'nota_fiscal'}});
    const scope={motoristaId:upload.motoristaId,periodoPagamentoId:upload.periodoPagamentoId,basePagamentoId:upload.basePagamentoId};
    if (existing && Object.entries(scope).some(([key, value]) => {
      const current = existing[key as keyof typeof scope];
      return current !== null && current !== value;
    })) throw new Error('Recebimento com vínculo divergente; revisão necessária.');
    const received=existing
      ? await tx.driverPdfReceived.update({where:{id:existing.id},data:scope})
      : await tx.driverPdfReceived.create({data:{...scope,uploadPdfId:upload.id,documentType:'nota_fiscal',
          status:'nota_fiscal_recebida',nomeArquivo:upload.nomeOriginal,caminhoArquivo:upload.caminhoArquivo,
          usuarioId:upload.usuarioId,uploadEm:upload.criadoEm}});
    return {receivedId:received.id,persisted:true};
  });
}

export type InvoiceDeliveryAlert={id:string;sourceUploadId:string;driver:string;period:string;base:string;kind:string;errorCode:string|null;attempts:number;updatedAt:Date;hasArchive:boolean};

export async function listInvoiceDeliveryAlerts(periodId:string|null,baseId:string|null) {
  const [tables]=await prisma.$queryRaw<Array<{attempts:boolean;outbox:boolean;clientErrors:boolean}>>`
    SELECT to_regclass('portal_administrativo.invoice_delivery_attempts') IS NOT NULL attempts,
      to_regclass('portal_administrativo.invoice_webhook_outbox') IS NOT NULL outbox,
      to_regclass('public.client_error_events') IS NOT NULL "clientErrors"`;
  const branches:string[]=[];
  branches.push(`SELECT 'scope:'||r.id::text id,u.id source_id,
    'scope' kind,'INVOICE_SCOPE_INCOMPLETE' error_code,1 attempts,u.criado_em updated_at,false has_archive
    FROM portal_administrativo.driver_pdf_received r JOIN portal_administrativo.uploads_pdf u ON u.id=r.upload_pdf_id
    WHERE r.document_type='nota_fiscal' AND u.document_type='nota_fiscal' AND u.status::text NOT IN ('removido','substituido')
      AND (r.motorista_id IS NULL OR r.periodo_pagamento_id IS NULL OR r.base_pagamento_id IS NULL
        OR r.motorista_id IS DISTINCT FROM u.motorista_id OR r.periodo_pagamento_id IS DISTINCT FROM u.periodo_pagamento_id
        OR r.base_pagamento_id IS DISTINCT FROM u.base_pagamento_id)`);
  branches.push(`SELECT 'missing-receipt:'||u.id::text id,u.id source_id,
    'scope' kind,'INVOICE_RECEIPT_MISSING' error_code,1 attempts,u.criado_em updated_at,false has_archive
    FROM portal_administrativo.uploads_pdf u WHERE u.document_type='nota_fiscal'
      AND u.status::text NOT IN ('removido','substituido')
      AND NOT EXISTS(SELECT 1 FROM portal_administrativo.driver_pdf_received r
        WHERE r.upload_pdf_id=u.id AND r.document_type='nota_fiscal')`);
  if(tables.attempts) branches.push(`SELECT a.id::text id,a.source_upload_id source_id,
    'upload' kind,a.error_code,1 attempts,a.updated_at,(a.archive_storage_key IS NOT NULL OR a.archive_content IS NOT NULL) has_archive
    FROM portal_administrativo.invoice_delivery_attempts a
    WHERE a.status='failed' OR (a.status IN ('processing','received') AND a.updated_at<now()-interval '10 minutes')`);
  if(tables.attempts) branches.push(`SELECT a.id::text id,a.source_upload_id source_id,
    'storage' kind,a.storage_error_code error_code,1 attempts,a.updated_at,true has_archive
    FROM portal_administrativo.invoice_delivery_attempts a WHERE a.status='persisted' AND a.storage_error_code IS NOT NULL`);
  if(tables.outbox) branches.push(`SELECT o.event_id id,(o.payload->>'sourceUploadId')::uuid source_id,
    'integration' kind,o.error_code,o.attempts,o.created_at updated_at,false has_archive
    FROM portal_administrativo.invoice_webhook_outbox o WHERE o.status<>'delivered'
      AND (o.attempts>0 OR o.created_at<now()-interval '5 minutes')`);
  if(tables.clientErrors) branches.push(`SELECT 'historical:'||u.id::text id,u.id source_id,
    CASE WHEN bool_or(e.message ~ '/invoice$') THEN 'historical' ELSE 'preview' END kind,
    'HTTP_500' error_code,count(*)::int attempts,max(e.occurred_at) updated_at,false has_archive
    FROM public.client_error_events e JOIN portal_administrativo.uploads_pdf u
      ON u.id::text=substring(e.message from '/uploads/([0-9a-f-]{36})/invoice')
    WHERE e.error_code='HTTP_500' AND e.occurred_at>now()-interval '90 days'
      AND u.status::text NOT IN ('removido','substituido')
      AND NOT EXISTS(SELECT 1 FROM portal_administrativo.uploads_pdf n WHERE n.document_type='nota_fiscal'
        AND n.status::text NOT IN ('removido','substituido') AND
        (n.source_upload_id=u.id OR (n.motorista_id=u.motorista_id AND n.periodo_pagamento_id=u.periodo_pagamento_id AND n.base_pagamento_id=u.base_pagamento_id)))
      AND NOT EXISTS(SELECT 1 FROM portal_administrativo.driver_pdf_received r WHERE r.document_type='nota_fiscal'
        AND r.motorista_id=u.motorista_id AND r.periodo_pagamento_id=u.periodo_pagamento_id AND r.base_pagamento_id=u.base_pagamento_id)
    GROUP BY u.id`);
  if(!branches.length) return {trackingAvailable:false,total:0,alerts:[]};
  const alerts=await prisma.$queryRawUnsafe<Array<InvoiceDeliveryAlert & {total:number}>>(`
    WITH alerts AS (${branches.join(' UNION ALL ')})
    SELECT a.id,a.source_id "sourceUploadId",COALESCE(m.nome,u.motorista_nome_extraido,'Motorista não identificado') driver,
      COALESCE(p.nome,'Período não identificado') period,b.nome base,a.kind,a.error_code "errorCode",a.attempts,a.updated_at "updatedAt",a.has_archive "hasArchive",
      count(*) OVER()::int total FROM alerts a JOIN portal_administrativo.uploads_pdf u ON u.id=a.source_id
    LEFT JOIN portal_administrativo.motoristas m ON m.id=u.motorista_id
    LEFT JOIN portal_administrativo.periodos_pagamento p ON p.id=u.periodo_pagamento_id
    LEFT JOIN portal_administrativo.bases_pagamento b ON b.id=u.base_pagamento_id
    WHERE ($1::uuid IS NULL OR u.periodo_pagamento_id=$1::uuid OR (a.kind='scope' AND u.periodo_pagamento_id IS NULL)) AND ($2::uuid IS NULL OR u.base_pagamento_id=$2::uuid)
    ORDER BY a.updated_at DESC LIMIT 100`,periodId,baseId);
  return {trackingAvailable:tables.attempts && tables.outbox,total:alerts[0]?.total || 0,alerts};
}
