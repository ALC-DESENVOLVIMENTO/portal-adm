import { prisma } from '../src/lib/prisma.js';

async function main() {
  const ids = process.argv.filter(value => /^[0-9a-f-]{36}$/i.test(value));
  if (!ids.length) throw new Error('Informe os IDs explícitos dos recebimentos autorizados.');
  const apply = process.argv.includes('--apply');
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM portal_administrativo.driver_pdf_received WHERE id=ANY(${ids}::uuid[]) FOR UPDATE`;
    const rows = await tx.driverPdfReceived.findMany({where:{id:{in:ids}}});
    if (rows.length !== new Set(ids).size) throw new Error('Recebimento não encontrado.');
    const results = [];
    for (const row of rows) {
      if (row.status === 'processo_concluido') {results.push({id:row.id,alreadyCompleted:true});continue;}
      const audit = await tx.logAuditoria.findFirst({where:{entidadeId:row.id,acao:'anexar_nota_fiscal_manual'},orderBy:{criadoEm:'desc'}});
      const details = audit?.detalhes as Record<string,unknown> | null;
      const mirror = row.uploadPdfId ? await tx.uploadPdf.findUnique({where:{id:row.uploadPdfId}}) : null;
      const cnpj = String(details?.providerCnpj || '').replace(/\D/g,'');
      if (row.documentType !== 'nota_fiscal' || row.status !== 'nota_fiscal_recebida' || !row.content?.length
        || !audit?.usuarioId || audit.usuarioId !== row.usuarioId || cnpj.length !== 14
        || cnpj !== String(details?.beneficiaryCnpj || '').replace(/\D/g,'')
        || !mirror || mirror.documentType === 'nota_fiscal' || ['removido','substituido'].includes(mirror.status)
        || mirror.motoristaId !== row.motoristaId || mirror.periodoPagamentoId !== row.periodoPagamentoId
        || mirror.basePagamentoId !== row.basePagamentoId) throw new Error(`Recebimento ${row.id} exige revisão; reparo cancelado.`);
      if (apply) {
        await tx.driverPdfReceived.update({where:{id:row.id},data:{status:'processo_concluido',aprovadoEm:new Date(),aprovadoPorId:audit.usuarioId}});
        await tx.logAuditoria.create({data:{acao:'corrigir_conclusao_nf_manual',entidade:'driver_pdf_received',entidadeId:row.id,
          detalhes:{source:'authorized_manual_flow_repair',manualUploadAuditId:audit.id,
            originalUploadUserId:audit.usuarioId,before:{status:row.status,aprovadoEm:row.aprovadoEm?.toISOString() || null,aprovadoPorId:row.aprovadoPorId},
            after:{status:'processo_concluido'},paymentStatusPreserved:mirror.statusPagamento}}});
      }
      results.push({id:row.id,statusBefore:row.status,statusAfter:'processo_concluido',paymentStatusPreserved:mirror.statusPagamento});
    }
    return results;
  },{timeout:20000});
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',results:result}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Reparo não executado');process.exitCode=1;}).finally(()=>prisma.$disconnect());
