import {prisma} from '../src/lib/prisma.js';

// Dry run by default. Only missing fields are filled from the referenced invoice.
async function main(){
  const rows=await prisma.$queryRaw<Array<{id:string}>>`
    SELECT r.id FROM portal_administrativo.driver_pdf_received r JOIN portal_administrativo.uploads_pdf u ON u.id=r.upload_pdf_id
    WHERE r.document_type='nota_fiscal' AND u.document_type='nota_fiscal'
      AND (r.motorista_id IS NULL OR r.periodo_pagamento_id IS NULL OR r.base_pagamento_id IS NULL)
      AND u.motorista_id IS NOT NULL AND u.periodo_pagamento_id IS NOT NULL AND u.base_pagamento_id IS NOT NULL
      AND (r.motorista_id IS NULL OR r.motorista_id=u.motorista_id)
      AND (r.periodo_pagamento_id IS NULL OR r.periodo_pagamento_id=u.periodo_pagamento_id)
      AND (r.base_pagamento_id IS NULL OR r.base_pagamento_id=u.base_pagamento_id)`;
  if(!process.argv.includes('--apply')){console.log(JSON.stringify({mode:'dry-run',eligible:rows.length}));return;}
  const result=await prisma.$transaction(async tx=>{
    const before=await tx.$queryRaw<Array<{id:string;motorista_id:string|null;periodo_pagamento_id:string|null;base_pagamento_id:string|null}>>`
      SELECT r.id,r.motorista_id,r.periodo_pagamento_id,r.base_pagamento_id
      FROM portal_administrativo.driver_pdf_received r JOIN portal_administrativo.uploads_pdf u ON u.id=r.upload_pdf_id
      WHERE r.document_type='nota_fiscal' AND u.document_type='nota_fiscal'
        AND (r.motorista_id IS NULL OR r.periodo_pagamento_id IS NULL OR r.base_pagamento_id IS NULL)
        AND u.motorista_id IS NOT NULL AND u.periodo_pagamento_id IS NOT NULL AND u.base_pagamento_id IS NOT NULL
        AND (r.motorista_id IS NULL OR r.motorista_id=u.motorista_id)
        AND (r.periodo_pagamento_id IS NULL OR r.periodo_pagamento_id=u.periodo_pagamento_id)
        AND (r.base_pagamento_id IS NULL OR r.base_pagamento_id=u.base_pagamento_id) FOR UPDATE OF r`;
    const updated=await tx.$queryRaw<Array<{id:string}>>`
      UPDATE portal_administrativo.driver_pdf_received r SET
        motorista_id=COALESCE(r.motorista_id,u.motorista_id),periodo_pagamento_id=COALESCE(r.periodo_pagamento_id,u.periodo_pagamento_id),
        base_pagamento_id=COALESCE(r.base_pagamento_id,u.base_pagamento_id)
      FROM portal_administrativo.uploads_pdf u WHERE u.id=r.upload_pdf_id AND r.document_type='nota_fiscal' AND u.document_type='nota_fiscal'
        AND r.id = ANY(${before.map(r=>r.id)}::uuid[])
        AND (r.motorista_id IS NULL OR r.periodo_pagamento_id IS NULL OR r.base_pagamento_id IS NULL)
        AND u.motorista_id IS NOT NULL AND u.periodo_pagamento_id IS NOT NULL AND u.base_pagamento_id IS NOT NULL
        AND (r.motorista_id IS NULL OR r.motorista_id=u.motorista_id)
        AND (r.periodo_pagamento_id IS NULL OR r.periodo_pagamento_id=u.periodo_pagamento_id)
        AND (r.base_pagamento_id IS NULL OR r.base_pagamento_id=u.base_pagamento_id) RETURNING r.id`;
    await tx.logAuditoria.create({data:{acao:'reparar_escopo_recebimento_nf',entidade:'driver_pdf_received',detalhes:{receiptIds:updated.map(r=>r.id),before:before.filter(r=>updated.some(u=>u.id===r.id)),source:'referenced_invoice_only'}}});
    return updated.length;
  });
  console.log(JSON.stringify({mode:'apply',updated:result}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Repair failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
