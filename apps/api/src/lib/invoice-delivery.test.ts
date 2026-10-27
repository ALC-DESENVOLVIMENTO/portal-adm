import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const enabled=Boolean(process.env.INVOICE_TEST_DATABASE_URL);
if(enabled){const u=new URL(process.env.DATABASE_URL!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.startsWith('/invoice_delivery_test'))throw new Error('Use a dedicated local invoice_delivery_test database');}
after(async()=>{if(enabled){const {prisma}=await import('./prisma.js');await prisma.$disconnect();}});
test('created invoice webhook repairs scope, is idempotent and never changes an existing fiscal decision',{skip:!enabled},async()=>{
  const {prisma}=await import('./prisma.js');
  const {acceptPersistedInvoice,listInvoiceDeliveryAlerts}=await import('./invoice-delivery.js');
  const key=randomUUID();
  await prisma.$executeRawUnsafe('ALTER TABLE portal_administrativo.uploads_pdf ADD COLUMN IF NOT EXISTS source_upload_id uuid');
  const user=await prisma.usuario.create({data:{nome:'Integration test',email:`${key}@example.invalid`,senhaHash:'unused',nivel:{connectOrCreate:{where:{codigo:'N4'},create:{codigo:'N4',nome:'Test'}}}}});
  const base=await prisma.basePagamento.create({data:{nome:`Test ${key}`,tipoPadrao:'semanal'}});
  const period=await prisma.periodoPagamento.create({data:{nome:`Test ${key}`,dataInicio:new Date('2026-10-11'),dataFim:new Date('2026-10-17'),tipo:'semanal',criadoPorId:user.id}});
  const driver=await prisma.motorista.create({data:{nome:'Test driver',cpf:`test-${key.slice(0,14)}`}});
  const scope={motoristaId:driver.id,basePagamentoId:base.id,periodoPagamentoId:period.id};
  const upload=await prisma.uploadPdf.create({data:{...scope,nomeArquivo:'nf.pdf',nomeOriginal:'nf.pdf',caminhoArquivo:'test/nf.pdf',status:'processado',documentType:'nota_fiscal',usuarioId:user.id}});
  const old=await prisma.driverPdfReceived.create({data:{motoristaId:driver.id,uploadPdfId:upload.id,documentType:'nota_fiscal',status:'processo_concluido'}});
  const accepted=await acceptPersistedInvoice(upload.id);
  assert.equal(accepted.receivedId,old.id);
  assert.equal((await acceptPersistedInvoice(upload.id)).receivedId,old.id);
  const fixed=await prisma.driverPdfReceived.findUniqueOrThrow({where:{id:old.id}});
  assert.equal(fixed.basePagamentoId,base.id);assert.equal(fixed.periodoPagamentoId,period.id);assert.equal(fixed.status,'processo_concluido');
  await prisma.driverPdfReceived.update({where:{id:old.id},data:{basePagamentoId:null,periodoPagamentoId:null}});
  const repair=execFileSync(process.execPath,['--import','tsx','apps/api/scripts/repair-invoice-receipt-scope.ts','--apply'],{encoding:'utf8',env:process.env,cwd:fileURLToPath(new URL('../../../../',import.meta.url))});
  assert.ok(JSON.parse(repair).updated>=1);
  const repaired=await prisma.driverPdfReceived.findUniqueOrThrow({where:{id:old.id}});
  assert.equal(repaired.periodoPagamentoId,period.id);assert.equal(repaired.basePagamentoId,base.id);assert.equal(repaired.status,'processo_concluido');
  const otherPeriod=await prisma.periodoPagamento.create({data:{nome:`Other ${key}`,dataInicio:new Date('2026-10-18'),dataFim:new Date('2026-10-24'),tipo:'semanal',criadoPorId:user.id}});
  await prisma.driverPdfReceived.update({where:{id:old.id},data:{periodoPagamentoId:otherPeriod.id}});
  await assert.rejects(()=>acceptPersistedInvoice(upload.id),/divergente/);
  await prisma.driverPdfReceived.update({where:{id:old.id},data:{periodoPagamentoId:period.id}});
  const newUpload=await prisma.uploadPdf.create({data:{...scope,nomeArquivo:'new-nf.pdf',nomeOriginal:'new-nf.pdf',caminhoArquivo:'test/new-nf.pdf',status:'processado',documentType:'nota_fiscal',usuarioId:user.id}});
  assert.ok((await listInvoiceDeliveryAlerts(period.id,base.id)).alerts.some(a=>a.sourceUploadId===newUpload.id && a.errorCode==='INVOICE_RECEIPT_MISSING'));
  const newReceipt=await acceptPersistedInvoice(newUpload.id);
  assert.equal((await prisma.driverPdfReceived.findUniqueOrThrow({where:{id:newReceipt.receivedId}})).status,'nota_fiscal_recebida');
  await prisma.uploadPdf.update({where:{id:upload.id},data:{documentType:'espelho'}});
  await assert.rejects(()=>acceptPersistedInvoice(upload.id),/vínculo completo/);
  await prisma.$executeRaw`INSERT INTO portal_administrativo.invoice_delivery_attempts(id,source_upload_id,file_sha256,original_name,status,error_code)
    VALUES(${randomUUID()}::uuid,${upload.id}::uuid,${key},'nf.pdf','failed','ECONNRESET')`;
  const alerts=await listInvoiceDeliveryAlerts(period.id,base.id);
  assert.ok(alerts.alerts.some(a=>a.sourceUploadId===upload.id));
  const otherBase=await listInvoiceDeliveryAlerts(period.id,randomUUID());
  assert.equal(otherBase.alerts.length,0);
});
