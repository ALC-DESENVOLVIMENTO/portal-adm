# Recebimento confiável de notas fiscais

O arquivo, a tentativa de envio e a decisão fiscal são registros distintos. Receber um PDF não aprova uma nota nem libera pagamento.

## Anexo manual autorizado no Financeiro

O endpoint manual exige `financeiro.nota.approve` e mantém as validações do arquivo, identidade/CNPJ, período e base. Após essas validações, grava a nota como `processo_concluido`, com aprovador, data e auditoria na mesma transação. O espelho é bloqueado durante a gravação para impedir dois anexos concorrentes. Isso não altera o pagamento: bloqueios e pagamentos já realizados continuam respeitados por “A pagar”. Uploads do Motorista e webhooks não recebem essa aprovação manual automaticamente.

Na seleção para pagamento, o recebimento da NF não ocupa o lugar do recebimento do espelho, mesmo quando ambos apontam para o mesmo `upload_pdf_id`.

O script `apps/api/scripts/repair-manual-invoices.ts` recebe IDs explícitos e é somente leitura por padrão. Com `--apply`, conclui apenas notas recebidas com arquivo preservado, auditoria de anexo manual, autor original, CNPJ conferido e vínculo consistente. Registra os valores anteriores para reversão e não altera status de pagamento. Não usar para aprovar notas recebidas pelo Motorista ou sem essas evidências.

## Contrato entre os portais

- O Portal do Motorista registra uma tentativa por espelho e SHA-256 do arquivo antes da validação, preservando os bytes em `portal_administrativo.invoice_delivery_attempts`.
- Reenvios do mesmo documento usam o mesmo protocolo. Requisições concorrentes não criam duas notas.
- Arquivo, recebimento com motorista/base/período, resultado da tentativa e evento `portal.invoice.created` são confirmados na mesma transação.
- O objeto de cada versão tem uma chave exclusiva. Uma falha de substituição não sobrescreve nem apaga a nota anterior.
- Se o S3 recusar assinatura ou ficar indisponível, a nota válida permanece em `uploads_pdf.content` e `driver_pdf_received.content`. O arquivo continua acessível; uma pendência de armazenamento é registrada e o worker tenta a cópia novamente.
- `invoice_webhook_outbox` mantém eventos até o Administrativo confirmar um `receivedId` persistido. Resposta ignorada, timeout e erro HTTP permanecem em reenvio, com espera crescente limitada a uma hora.
- `POST /api/webhooks/access-adm`, com a autenticação/assinatura existentes, aceita `portal.invoice.created` somente para uma nota já persistida e com vínculo completo. Preserva decisões fiscais existentes.
- O Financeiro consulta `GET /api/financeiro/invoice-delivery-alerts`, com os filtros de período e base. Inclui tentativas pendentes, integração, armazenamento, vínculos incompletos e erros históricos de envio/prévia sem nota localizada. Vínculos sem período aparecem como não identificados, não são atribuídos a outro período.
- Recuperação do arquivo de uma tentativa exige a permissão existente `financeiro.nota.approve`. O Analista de Risco não recebe acesso a documentos.

## Implantação e recuperação

O canal do Portal do Motorista usa `PDFONLINE_WEBHOOK_TOKEN`, com fallback para `PDFONLINE_BRIDGE_TOKEN`. Seu segredo dedicado é `INVOICE_CALLBACK_SECRET` no emissor e `PDFONLINE_INVOICE_WEBHOOK_SECRET` no receptor. Configurar o mesmo segredo nos dois serviços pelo mecanismo seguro de variáveis do Railway; não copiar valores para código ou logs. Esses nomes dedicados preservam as credenciais usadas por outros fluxos de pagamento e pelo ARCHI. Os fallbacks legados continuam disponíveis para compatibilidade. A investigação encontrou o token do Motorista compatível com o bridge, mas preterido pelo token ARCHI no receptor, e segredos de assinatura diferentes entre os serviços. O receptor continua recusando assinaturas inválidas.

1. Publicar primeiro o receptor/API do Administrativo e sua interface.
2. Publicar depois API/interface do Portal do Motorista. O bootstrap cria apenas tabelas/colunas/índices aditivos para tentativas e outbox.
3. Manter `BACKGROUND_WORKERS_ENABLED` habilitado na API responsável pelos jobs; o serviço web não executa workers. O worker roda a cada minuto e utiliza leases no PostgreSQL para múltiplas réplicas.
4. Conferir alertas e um envio controlado em homologação, incluindo timeout, repetição e indisponibilidade de armazenamento.
5. O reparo `npx tsx apps/api/scripts/repair-invoice-receipt-scope.ts` é somente leitura. `--apply` preenche campos faltantes a partir do upload de NF referenciado, sem divergências entre identidades, e grava os valores anteriores em auditoria. Não altera status fiscal, pagamento, valores ou catálogo de bases.

Rollback do código não exige remover tabelas. Preservar tentativas, bytes e outbox: contêm evidências de documentos recebidos. Para reverter um reparo de dados, usar o campo `before` da auditoria correspondente e revisar os registros; nunca apagar notas para desfazer o vínculo.

Sem o PDF original ou uma cópia persistida, um erro antigo de rede/prévia não permite reconstruir a NF. A pendência deve ser conferida e o documento reenviado; não inferir aprovação a partir do espelho.

## Evidências e reparo de 27/10/2026

- Nos registros desde 01/10, foram separados 65 erros de envio definitivo (21–22/10 UTC) de 14 erros de pré-validação. Os logs do serviço apresentam `SignatureDoesNotMatch` nos horários das falhas de envio. Isso confirma falhas de assinatura do armazenamento, sem evidência suficiente para atribuir qual alteração histórica de credencial as provocou.
- Elaine Maria de Freitas Arruda: Barretos, semanal 11–17/10/2026. O espelho existe; não foram localizados upload de NF, recebimento de NF ou objetos no prefixo esperado. Erros de rede na sessão não comprovam que a API recebeu a nota.
- Cleiton Souza de Paula: Nova Lima, mensal Rental agosto/2026. Há dois erros de pré-validação em 01/10, sem upload definitivo/recebimento de NF ou objeto recuperável no prefixo esperado.
- Foi aplicado o preenchimento seguro de 804 recebimentos com base/período faltantes. Auditoria `f96fa601-cebe-4ab5-ae54-61ff75cdff76`, ação `reparar_escopo_recebimento_nf`, em 27/10/2026 20:26:44 UTC. A conferência posterior retornou zero casos elegíveis para o mesmo reparo. Nenhum status fiscal, valor, pagamento ou catálogo foi alterado.
- Um recebimento recente de Israel Eliezer Schirmer De Oliveira permanece sem período porque o próprio upload referenciado não informa período. Não foi atribuído um período por aproximação; exige conferência do histórico.

Os ajustes de código estão isolados dos checkouts originais, partindo dos commits de produção `2c9733627b850aceb20516c0ff6bab1b9524e189` (Administrativo) e `d628911d04ea1961529cd3041e8c7d7de08ed138` (Motorista). A publicação autorizada inclui somente a confiabilidade do recebimento de notas e o segredo dedicado dessa integração. Não inclui as mudanças locais pendentes do catálogo de bases.

## Testes

Os testes de integração exigem PostgreSQL local com banco cujo nome comece por `invoice_delivery_test`. Criar o schema com Prisma somente nesse banco, nunca apontar os testes para produção.

```powershell
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55437/invoice_delivery_test?schema=portal_administrativo'
$env:INVOICE_TEST_DATABASE_URL=$env:DATABASE_URL
npx tsx --test apps/api/src/lib/invoice-delivery.test.ts
```

No Portal do Motorista, `tests/invoice-delivery.test.ts` valida concorrência, repetição, rollback, assinatura recusada, recuperação do armazenamento e confirmação do recebimento. Os testes de interface usam fixtures locais identificadas, sem contas, anexos ou mensagens de produção.
