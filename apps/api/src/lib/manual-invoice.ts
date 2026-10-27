import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

type ManualInvoiceInput = {
  uploadPdfId: string;
  motoristaId: string;
  periodId: string;
  baseId: string;
  userId: string;
  fileName: string;
  storageKey: string;
  content: Buffer;
  ip?: string;
  userAgent?: string | null;
  auditDetails: Prisma.InputJsonObject;
};

// Only the manual endpoint, protected by financeiro.nota.approve, calls this.
// Driver uploads and webhooks retain their own fiscal review workflow.
export async function completeManualInvoice(input: ManualInvoiceInput) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM portal_administrativo.uploads_pdf WHERE id=${input.uploadPdfId}::uuid FOR UPDATE`;
    const mirror = await tx.uploadPdf.findUnique({where: {id: input.uploadPdfId}});
    if (!mirror || mirror.documentType === 'nota_fiscal' || ['removido', 'substituido'].includes(mirror.status)
      || mirror.motoristaId !== input.motoristaId || mirror.periodoPagamentoId !== input.periodId
      || mirror.basePagamentoId !== input.baseId || input.content.length === 0) {
      throw Object.assign(new Error('Espelho ou arquivo inválido para concluir a nota manual.'), {statusCode: 422});
    }
    const existing = await tx.driverPdfReceived.findFirst({where: {
      motoristaId: input.motoristaId, periodoPagamentoId: input.periodId, basePagamentoId: input.baseId,
      documentType: 'nota_fiscal', status: {in: ['nota_fiscal_recebida', 'nota_fiscal_em_analise', 'nota_fiscal_aprovada', 'processo_concluido']}
    }});
    if (existing) throw Object.assign(new Error('Já existe uma NF vinculada a este motorista, período e base.'), {statusCode: 409});
    const now = new Date();
    const received = await tx.driverPdfReceived.create({data: {
      motoristaId: input.motoristaId, periodoPagamentoId: input.periodId, basePagamentoId: input.baseId,
      uploadPdfId: mirror.id, documentType: 'nota_fiscal', nomeArquivo: input.fileName,
      caminhoArquivo: input.storageKey, tipoArquivo: 'application/pdf', content: input.content,
      usuarioId: input.userId, uploadEm: now, status: 'processo_concluido',
      aprovadoEm: now, aprovadoPorId: input.userId
    }});
    await tx.logAuditoria.create({data: {
      usuarioId: input.userId, acao: 'anexar_nota_fiscal_manual', entidade: 'driver_pdf_received',
      entidadeId: received.id, ipOrigem: input.ip, userAgent: input.userAgent,
      detalhes: {...input.auditDetails, linkedMirrorId: mirror.id, status: 'processo_concluido', approvalOrigin: 'manual_authorized_upload'}
    }});
    return received;
  });
}
