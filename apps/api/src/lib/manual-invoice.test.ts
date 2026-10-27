import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const enabled = Boolean(process.env.INVOICE_TEST_DATABASE_URL);
if (enabled) {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/invoice_delivery_test')) throw new Error('Dedicated local test database required');
}
after(async () => {if(enabled){const {prisma}=await import('./prisma.js');await prisma.$disconnect();}});

test('manual attachment atomically concludes and audits the NF, blocks duplicates and preserves payment', {skip:!enabled}, async () => {
  const {prisma}=await import('./prisma.js');
  const {completeManualInvoice}=await import('./manual-invoice.js');
  const id=randomUUID();
  const user=await prisma.usuario.create({data:{nome:'Local test',email:`${id}@example.invalid`,senhaHash:'unused',nivel:{connectOrCreate:{where:{codigo:'N4'},create:{codigo:'N4',nome:'Test'}}}}});
  const base=await prisma.basePagamento.create({data:{nome:`Local ${id}`,tipoPadrao:'semanal'}});
  const period=await prisma.periodoPagamento.create({data:{nome:`Local ${id}`,dataInicio:new Date('2026-10-11'),dataFim:new Date('2026-10-17'),tipo:'semanal',criadoPorId:user.id}});
  const driver=await prisma.motorista.create({data:{nome:'Local driver',cpf:`local-${id.slice(0,12)}`}});
  const mirror=await prisma.uploadPdf.create({data:{motoristaId:driver.id,periodoPagamentoId:period.id,basePagamentoId:base.id,nomeArquivo:'mirror.pdf',nomeOriginal:'mirror.pdf',caminhoArquivo:'local/mirror.pdf',documentType:'espelho',status:'processado',statusPagamento:'PAGO',usuarioId:user.id}});
  const input={uploadPdfId:mirror.id,motoristaId:driver.id,periodId:period.id,baseId:base.id,userId:user.id,fileName:'local-nf.pdf',storageKey:'local/nf.pdf',content:Buffer.from('local test bytes'),auditDetails:{providerCnpj:'11222333000181',beneficiaryCnpj:'11222333000181'}};
  await assert.rejects(()=>completeManualInvoice({...input,baseId:randomUUID()}));
  await assert.rejects(()=>completeManualInvoice({...input,userId:randomUUID()}));
  await assert.rejects(()=>completeManualInvoice({...input,ip:'x'.repeat(65)}));
  assert.equal(await prisma.driverPdfReceived.count({where:{uploadPdfId:mirror.id}}),0);
  const concurrent=await Promise.allSettled([completeManualInvoice(input),completeManualInvoice(input)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  const received=await prisma.driverPdfReceived.findFirstOrThrow({where:{uploadPdfId:mirror.id}});
  assert.equal(received.documentType,'nota_fiscal');assert.equal(received.status,'processo_concluido');
  assert.equal(received.aprovadoPorId,user.id);assert.ok(received.aprovadoEm);
  assert.deepEqual(received.content,input.content);
  assert.equal(await prisma.logAuditoria.count({where:{entidadeId:received.id,acao:'anexar_nota_fiscal_manual'}}),1);
  assert.equal((await prisma.uploadPdf.findUniqueOrThrow({where:{id:mirror.id}})).statusPagamento,'PAGO');
  await prisma.driverPdfReceived.update({where:{id:received.id},data:{status:'nota_fiscal_recebida',aprovadoEm:null,aprovadoPorId:null}});
  const runRepair=(apply:boolean)=>JSON.parse(execFileSync(process.execPath,['--import','tsx','apps/api/scripts/repair-manual-invoices.ts',received.id,...(apply?['--apply']:[])],{encoding:'utf8',env:process.env,cwd:fileURLToPath(new URL('../../../../',import.meta.url))}));
  assert.equal(runRepair(false).mode,'dry-run');
  assert.equal((await prisma.driverPdfReceived.findUniqueOrThrow({where:{id:received.id}})).status,'nota_fiscal_recebida');
  assert.equal(runRepair(true).results[0].statusAfter,'processo_concluido');
  assert.equal(runRepair(true).results[0].alreadyCompleted,true);
  assert.equal(await prisma.logAuditoria.count({where:{entidadeId:received.id,acao:'corrigir_conclusao_nf_manual'}}),1);
  assert.equal((await prisma.uploadPdf.findUniqueOrThrow({where:{id:mirror.id}})).statusPagamento,'PAGO');
});
