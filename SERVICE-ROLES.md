# Separação web e API

A imagem suporta APP_ROLE=web ou APP_ROLE=api. Sem APP_ROLE mantém o modo anterior.

- API: comando original, bancos e integrações existentes; não serve a interface.
- Web: apenas interface estática e proxy sem buffer para /api e /storage. Não inicia jobs nem conecta ao banco.
- API_BACKEND_URL: URL privada do backend do mesmo ambiente, porta 8080.
- STATIC_WEB_ROOT: dist (ARCHI) ou apps/web/dist (Portal).
- WEB_SECURITY_HEADERS: cabeçalhos de segurança preservados da interface anterior.

Preservar os domínios públicos e as URLs de SSO/webhooks. Produção e staging têm variáveis e backends próprios.
Validar saúde, autenticação, cookies, CSRF, upload, SSE e integrações após cada troca.
Rollback: APP_ROLE vazio no serviço web restaura o processo original na mesma imagem; só então parar a API separada, evitando dois workers permanentes. Nenhuma migração destrutiva faz parte desta separação.

## Transferência de jobs

Preparar a API com BACKGROUND_JOBS_ENABLED=false. Após validar a API e trocar a interface para APP_ROLE=web, reimplantar a API com BACKGROUND_JOBS_ENABLED=true. O frontend não executa nenhuma rotina de banco.

## Serviços Railway

Projeto: ALC — Financeiro. ARCHI: Aplicação — Archi (web) e archi-api (backend). Portal: Aplicação — Acesso Administrativo (web) e portal-administrativo-api (backend). Os nomes se repetem em production e staging, com configuração isolada por ambiente. As APIs não têm domínio público; os domínios antigos continuam sendo a entrada dos usuários e das integrações.
