# Arquitetura do LIFE CLASS

## Visão geral

```
Navegador (React)                     Servidor (Node.js + Fastify)                 Dados
─────────────────                     ────────────────────────────                 ─────
SPA em React 18 + Tailwind      ─►    Cabeçalhos de segurança (CSP, HSTS...)  ─►   PostgreSQL (Drizzle ORM)
Sessão em cookie HttpOnly             Resolução da sessão (cookie opaco)            Armazenamento privado
Token CSRF só em memória              CSRF + checagem de origem                     (disco local ou S3)
Leitor: imagens de página             Negação por padrão (rota pública = exceção)   Auditoria somente inclusão
em <canvas>, sem arquivo              Validação de entrada (zod)
                                      Autorização no servidor a cada operação
                                      Serviços: trilhas, leitura, avaliações...
                                      Fila interna: processamento de PDF/DOCX
```

- **Front-end:** React 18, React Router 7, TanStack Query, Tailwind CSS 4, Recharts e ícones Lucide. Em produção, é servido pelo próprio servidor (`dist/web`).
- **Back-end:** Fastify 5 com TypeScript, validação com zod e Drizzle ORM. As migrações são versionadas em `server/db/migrations` e aplicadas ao iniciar.
- **Banco:** PostgreSQL em produção. Em desenvolvimento e nos testes, o PGlite (PostgreSQL embutido) usa o mesmo esquema e as mesmas migrações.
- **Arquivos:** `local` (pasta privada em `data/storage`, nunca servida diretamente) ou `s3` (bucket privado com criptografia SSE, sem URL assinada nem pública).
- **Documentos:** pdf.js no servidor extrai texto, sumário e contagem de palavras, e as páginas são renderizadas em WebP com @napi-rs/canvas. A conversão de DOCX usa o LibreOffice, quando instalado. O antivírus é o ClamAV, opcional.

- **Identidade visual ("Modelo Life", do simulador de consórcio):** laranja Life `#F05A00`, degradê `#F7A23A → #F05A00` nos indicadores em destaque, tema escuro preto (`#000`, cartões `#111`) e tema claro `#ECE9E5` com cartões brancos; fonte Klavika com Titillium Web como alternativa. Títulos em caixa alta e finos, com a última palavra em negrito e laranja e um traço fino abaixo (`LifeTitle`); cartões com cantos de 22 px, borda sutil e leve degradê; botões, abas e seletor de tema em pílula; ícones em laranja. Texto e links usam tons calculados para 6:1 de contraste (`#B03D00` no claro, `#FF7A2E` no escuro), e o botão principal é `#CC4800` com texto branco. Os tokens ficam em `web/src/index.css`; cores, fontes e os dois logotipos são ajustáveis em Configurações, e os tons acessíveis são recalculados a partir da cor escolhida. Por padrão o tema segue o sistema da pessoa, que pode trocar no topo da tela.
- **Dicas de função:** botões só com ícone mostram, ao passar o mouse ou ao receber foco pelo teclado, o nome da ação (o mesmo `aria-label` lido por leitores de tela).

O código compartilhado (`shared/`) concentra os rótulos, enums, o cálculo do tempo de leitura e as configurações padrão, para que interface e servidor não divirjam.

## Ciclo de uma requisição

1. **Cabeçalhos:** CSP restritiva (`script-src 'self'`, sem `unsafe-eval`), `frame-ancestors 'none'`, HSTS, `Referrer-Policy: same-origin`, `Permissions-Policy` e `X-Robots-Tag: noindex` em todas as respostas.
2. **Sessão:** o cookie `__Host-lc_session` (HttpOnly, Secure, SameSite=Strict) carrega um token opaco. No banco fica apenas o SHA-256 do token. A sessão expira por inatividade (padrão de 60 min) e por tempo máximo (padrão de 12 h).
3. **CSRF:** métodos que alteram dados exigem o cabeçalho `X-CSRF-Token`, que vem do token sincronizado da sessão e é obtido em `/api/auth/me` e mantido só em memória no navegador. Exigem também `Origin`/`Referer` dentro das origens permitidas.
4. **Negação por padrão:** toda rota `/api` exige sessão completa. Uma rota só é pública se declarar `config.public`. Uma sessão parcial (senha correta, MFA pendente) só alcança as rotas de MFA. Uma pessoa aguardando liberação só alcança autenticação, primeiro acesso, perfil e notificações.
5. **Termos:** sem o aceite da versão vigente dos termos, nenhum conteúdo é entregue.
6. **Autorização:** cada rota consulta a política central (`server/authz/policy.ts`) com os identificadores do recurso. A rota nunca confia no que a interface escondeu.
7. **Auditoria:** login, falhas, MFA, alterações de permissão, publicações, uploads, downloads, exportações, leituras de documentos e acessos negados são registrados.

## Autenticação

- **Senhas:** Argon2id (19 MiB, 2 iterações). Política com mínimo configurável (padrão de 10 caracteres), letras e números, sem nome ou e-mail, sem datas e fora de uma lista de senhas comuns. As 5 últimas senhas não podem ser reutilizadas.
- **Bloqueio:** após 5 falhas (configurável), a conta fica bloqueada por 15 min. E-mails inexistentes também acumulam falhas, para não revelar quais contas existem. A resposta é sempre genérica, e a verificação de senha leva o mesmo tempo com ou sem conta.
- **MFA (TOTP):** obrigatório para administradores e líderes, e para quem o ativar voluntariamente. A chave fica cifrada com AES-256-GCM (chave derivada de `APP_SECRET` por HKDF). Há proteção contra reutilização do mesmo código e 8 códigos de recuperação de uso único. A sessão é trocada após a verificação.
- **Cadastro só por convite:** o administrador cria o usuário e um link pessoal, de uso único e com validade. Sem SMTP, o link aparece para o administrador enviar por canal seguro.
- **Recuperação de senha:** resposta genérica e no máximo 3 pedidos por hora. O link é de uso único e, ao ser usado, revoga todas as sessões. O administrador também pode gerar o link quando não há SMTP.
- **Sessões:** cada usuário vê e encerra as próprias sessões. O administrador encerra sessões de qualquer usuário, e desativar um usuário encerra todas elas na hora.

## Ciclo de acesso do colaborador

```
convite ──► ativação (senha) ──► [aguardando liberação] ──► ativo ──► desligado
                                  │ opcional, por convite     │         (imediato ou agendado)
                                  └─ recusar ─► desativado    └─ desativar ─► desativado
```

- **Liberação após o primeiro acesso:** em Configurações › Primeiro acesso, o administrador define se novos convites aguardam liberação (padrão: não). A escolha pode ser feita em cada convite. Com liberação exigida, a pessoa ativa a conta, faz o primeiro acesso e edita o perfil, mas o servidor recusa trilhas, conteúdos e painéis (`403 awaiting_approval`). Os administradores são notificados e liberam ou recusam na ficha do usuário. Recusar desativa a conta e encerra as sessões.
- **Primeiro acesso obrigatório ou opcional:** também em Configurações › Primeiro acesso. Obrigatório (padrão), boas-vindas e ciência dos termos vêm antes de qualquer conteúdo. Opcional, a pessoa entra direto no painel e vê um aviso para concluir depois. O aceite dos termos deixa de bloquear conteúdos.
- **Desligamento:** ação própria na ficha do usuário, com motivo obrigatório (registrado na auditoria), imediata ou agendada para data e hora. Ao executar, o servidor:
  - tranca o login e encerra todas as sessões;
  - invalida links de convite e de redefinição de senha;
  - remove lideranças de equipes e de áreas;
  - preserva o histórico de aprendizagem, as notas e os certificados.
- **Desligamento agendado:** a data é verificada em três pontos: na resolução de cada sessão (recusada a partir do horário), no login (que executa o desligamento vencido) e numa rotina a cada 10 minutos, que conclui os desligamentos e registra na auditoria. O agendamento pode ser cancelado. O administrador não desliga a si mesmo nem o último administrador ativo. A anonimização (LGPD) continua sendo uma ação separada.

## Autorização

Os perfis são **administrador geral**, **líder de área** e **colaborador**. A regra é avaliada sobre a cadeia **área → trilha → módulo → conteúdo**, nesta ordem:

1. O administrador acessa tudo, inclusive rascunhos, para pré-visualizar.
2. O conteúdo precisa estar publicado em toda a cadeia. Só o administrador pré-visualiza rascunhos.
3. Uma regra **negar** em qualquer nível que alcance o usuário bloqueia, e prevalece sobre qualquer liberação.
4. O líder acessa as trilhas das áreas pelas quais responde.
5. Uma trilha do tipo **livre** é aberta a todos os usuários ativos.
6. A atribuição da trilha (pelo administrador, pelo líder ou por regra) libera a trilha. Iniciar por conta própria só registra progresso e não concede acesso.
7. Uma regra **permitir** em qualquer nível libera. Ela vale para usuário, cargo, equipe, departamento, perfil ou todos, e pode ter validade.
8. Fora desses casos, o acesso é negado.

Mais detalhes:
- **Acesso parcial:** a trilha mostra só os módulos ou conteúdos liberados.
- **Sequência:** há pré-requisito entre trilhas ("dependente"), módulo que exige o anterior e conteúdo que depende de outro.
- **Vitrine bloqueada:** conforme a configuração, uma trilha sem acesso aparece com cadeado (só a apresentação, com pedido de acesso) ou fica oculta. Ver a vitrine não é tentativa de acesso. Abrir o conteúdo é negado e registrado.
- **Escopo do líder:** áreas que acompanha e equipes lideradas. Ele só vê, atribui, valida e corrige dentro desse escopo. O líder **não cria nem altera** áreas, trilhas, módulos, conteúdos, avaliações ou o banco de questões: toda escrita de conteúdo é exclusiva do administrador e recusada no servidor (`canManageArea` só concede leitura ao líder).
- **Identificadores:** são UUIDs, e toda leitura confere o vínculo, de modo que trocar o identificador na URL não expõe dados de outro usuário.
- **Explicação da decisão:** a tela de Permissões mostra se um usuário pode acessar um recurso e por quê, e quem tem acesso a um recurso.

## Leitor protegido

```
Upload (administrador)
  └─ valida formato pelo conteúdo (assinatura do arquivo) e tamanho
  └─ marca riscos do PDF (JavaScript, ações de abertura, anexos)
  └─ antivírus ClamAV (se configurado); arquivo infectado é recusado
  └─ guarda o original em armazenamento privado (SHA-256 registrado)
  └─ fila de processamento: texto e contagem de palavras por página,
     sumário (marcadores do PDF ou títulos detectados pela fonte),
     páginas renderizadas em WebP (~1600 px), também privadas
Leitura (colaborador autorizado)
  └─ /api/contents/:id → metadados (sem endereço de arquivo)
  └─ /api/contents/:id/pages/:n/image → autorização + limite por minuto
     + marca d'água individual gravada na imagem a cada entrega
     (nome, identificador LC-000000, data e hora, sessão de leitura)
  └─ modo texto acessível (texto da página, também autorizado)
```

- O arquivo original nunca vai ao navegador do colaborador. O download fica desativado por padrão e, quando habilitado, é registrado. O download do original para o administrador também é registrado.
- A interface desenha a página em `<canvas>` e bloqueia o menu de contexto, a seleção sobre a imagem, a impressão (CSS de impressão) e os atalhos de salvar e imprimir, sempre registrando as tentativas.
- A autorização é revalidada a cada página: há um cache de 15 s por sessão, invalidado por qualquer alteração administrativa. Desativar o usuário derruba a sessão imediatamente.
- `noindex` em toda a aplicação, `robots.txt` bloqueando tudo e nenhuma URL pública ou permanente de arquivo.
- **Limite honesto:** nenhuma tecnologia web impede fotografar a tela ou capturá-la com outro programa. A marca d'água individual serve para dissuadir e rastrear vazamentos.

## Tempo de leitura e progresso

- **Estimativa:** palavras ÷ palavras por minuto (padrão de 200, configurável por plataforma e por área) × fator de complexidade do conteúdo. Para PDF sem texto (digitalizado), usa minutos por página. O tempo pode ser ajustado manualmente por conteúdo.
- **Medição:** o leitor separa **tempo de visualização** (aba aberta) de **tempo ativo** (com interação). Após 120 s sem interação, o tempo ativo para de contar. Uma página só conta como lida depois de um tempo ativo mínimo (padrão de 6 s). O servidor limita cada pulso ao tempo realmente decorrido.
- **Conclusão:** a apostila é concluída com 90% das páginas lidas (configurável). Trocar a versão da apostila preserva o progresso.
- **Trilha:** o status (não iniciada, em andamento, pendente de avaliação, aguardando validação prática, concluída, reprovada ou necessita revisão) é calculado a partir de conteúdos, avaliações, atividades e validação do líder. São quatro pilares: **estudado**, **avaliado**, **demonstrado** e **aplicado/validado**. O certificado é emitido quando a trilha permite.

## Avaliações e prática

- **Tipos:** múltipla escolha (uma ou várias respostas), verdadeiro ou falso, associação, ordenação, cálculo com tolerância e discursiva (correção manual).
- **Gabarito:** nunca é enviado antes do envio. As questões e alternativas são embaralhadas de forma determinística por tentativa, e pode haver sorteio de N questões, limite de tempo validado no servidor e número de tentativas.
- **Nota:** nota mínima (padrão de 80%, por área ou por avaliação), devolutiva completa ou só a nota, crédito parcial em associação e ordenação, e salvamento automático das respostas.
- **Atividades práticas:** "demonstrar" (simulação ou estudo de caso) e "executar" (aplicação real acompanhada). Exigem entrega e podem exigir validação do líder, que aprova ou devolve com comentários. A trilha também pode exigir a validação final do líder.

## Biblioteca

Cada item tem foto de capa (PNG, JPEG ou WebP, até 3 MB, proporção de livro) e pode ter um arquivo para download (PDF, Word, Excel, PowerPoint ou EPUB, até 50 MB). O formato é verificado pelo conteúdo do arquivo, não pela extensão, e passa pelo antivírus quando configurado. Arquivos só podem ser anexados a itens de conteúdo próprio, licenciado ou de licença aberta. Obras de terceiros sem autorização entram apenas como indicação, com link oficial. O download é feito pelo servidor, depois da autorização, e cada download é registrado na auditoria. Capa e arquivo ficam no armazenamento privado.

## Notificações

As notificações ficam na plataforma, com envio opcional por e-mail (tipos configuráveis e preferência de cada pessoa). Uma chave de deduplicação evita repetição. Os eventos são: trilha atribuída, novo conteúdo, prazo próximo, atraso, avaliação liberada ou corrigida, feedback do líder, certificado, atualização relevante de apostila obrigatória, atividade avaliada, resposta a dúvida, validação pendente, solicitação recebida ou respondida, pessoa aguardando liberação (para administradores) e acesso liberado.

## Modelo de dados

São 43 tabelas em `server/db/schema.ts`, agrupadas assim:

| Grupo | Tabelas |
| --- | --- |
| Pessoas e organização | `users`, `departments`, `teams`, `team_leaders`, `job_titles`, `leader_areas` |
| Catálogo | `knowledge_areas`, `tracks`, `track_job_titles`, `modules`, `contents`, `content_versions`, `document_pages`, `files` |
| Acesso | `access_rules`, `enrollments`, `requests` |
| Aprendizagem | `content_progress`, `reading_sessions`, `notes` (anotações e dúvidas privadas), `bookmarks`, `highlights`, `comments` (compartilhados, com resposta do líder) |
| Avaliação e prática | `assessments`, `questions`, `attempts`, `answers`, `practical_activities`, `practical_submissions`, `track_validations`, `feedbacks`, `certificates` |
| Comunicação e biblioteca | `notifications`, `library_items` |
| Segurança e conformidade | `sessions`, `auth_tokens`, `mfa_recovery_codes`, `password_history`, `terms_versions`, `terms_acceptances`, `audit_logs`, `entity_revisions`, `settings` |

- Chaves UUID, chaves estrangeiras com `ON DELETE` coerente e e-mail único sem distinção de maiúsculas.
- O progresso, as anotações e as tentativas ficam no banco e sobrevivem ao logout.
- `audit_logs` aceita apenas inclusão: gatilhos no banco recusam `UPDATE` e `DELETE`, exceto a rotina de retenção, que habilita uma variável da própria transação.
- `users` guarda o ciclo de acesso: status (convidado, aguardando liberação, ativo, desligado/desativado), se o convite exige liberação, quem liberou e quando, e o desligamento (data, motivo e responsável).
- `entity_revisions` guarda o histórico de alterações de trilhas, módulos, conteúdos e avaliações (quem, quando, o quê).

## Privacidade e LGPD

- **Minimização:** só os dados necessários à capacitação. O IP do aceite dos termos é guardado como HMAC.
- **Transparência:** o painel do líder mostra indicadores educacionais (progresso, notas, entregas, data da última atividade). Não mostra horários de uso, tempo de tela nem anotações pessoais, e o texto da tela informa isso.
- **Termos versionados:** o aceite registra usuário, data, hora e versão. Uma nova versão exige novo aceite.
- **Direitos do titular:** o colaborador exporta os próprios dados (JSON) e pode apagar as próprias anotações. O administrador anonimiza ex-colaboradores e preserva apenas estatísticas.
- **Retenção:** rotina diária, com prazos configuráveis, para sessões de leitura detalhadas (365 dias), notificações (180 dias) e auditoria (730 dias, mínimo de 180).
- **Contato:** o contato do encarregado (DPO) é configurável e aparece no primeiro acesso, na ajuda e na exportação.

**Procedimento de incidente (proposta para o encarregado validar):**
1. Conter: encerrar sessões (individualmente ou todas), desativar contas e revogar regras.
2. Investigar pela auditoria, filtrando e exportando por usuário, ação e período.
3. Avaliar o risco aos titulares.
4. Comunicar à ANPD e aos titulares quando aplicável.
5. Corrigir e registrar as lições aprendidas.

As responsabilidades de controlador e operador e o texto jurídico dos termos dependem da empresa (ver `docs/REQUISITOS.md`).

## Implantação e escala

**Na Vercel** (guia passo a passo em `docs/DEPLOY-VERCEL.md`):

```
Navegador ──► CDN da Vercel ── dist/web (interface, cabeçalhos de segurança do vercel.json)
          └─► /api/* ──► função api/index.js (o mesmo Fastify, até 300 s por requisição)
                          ├─ PostgreSQL Neon (DATABASE_URL com pooler; migrações no build)
                          └─ Vercel Blob privado (arquivos, páginas renderizadas, capas)
Envio > 4 MB:  navegador ──PUT com link assinado de uso único──► Blob (pasta temporária da pessoa)
               └─ confirmação na rota de sempre: lê do Blob, valida o conteúdo, grava o definitivo
Download > 4 MB: rota autorizada e auditada ──303──► link assinado do Blob válido por 5 min
Rotina diária (Vercel Cron, Authorization: Bearer CRON_SECRET): retenção, desligamentos agendados,
               documentos interrompidos e envios temporários abandonados
```

- As funções da Vercel limitam cada requisição e resposta a 4,5 MB; por isso os envios e downloads grandes passam pelo Blob com links assinados, sempre emitidos depois da verificação de permissão.
- O processamento das apostilas (texto e páginas em imagem) acontece na própria requisição de envio. Se for interrompido, a rotina diária retoma.
- Não há LibreOffice nem ClamAV na Vercel: as apostilas entram em PDF e o antivírus pode ser um serviço externo (`CLAMAV_HOST`).
- O banco começa vazio. O primeiro administrador é criado em `/configuracao-inicial` com o código `SETUP_TOKEN`, e a tela se desativa quando já existe administrador.

**Em servidor próprio ou contêiner:**

- Em produção, `APP_SECRET` e `DATABASE_URL` são obrigatórios e o servidor recusa iniciar sem eles. Os cookies são `Secure`. Use HTTPS no proxy reverso com `TRUST_PROXY=true`.
- Para mais de uma instância:
  - mover o limite de requisições para Redis (`@fastify/rate-limit` aceita esse armazenamento);
  - mover o processamento de documentos para uma fila externa (a classe `JobQueue` em `server/services/jobs.ts` isola esse ponto);
  - considerar que o cache de autorização do leitor (15 s) é por instância.
- Backups (banco e bucket), monitoramento de erros e alertas são de infraestrutura e estão listados em `REQUISITOS.md`.

## Pontos de extensão (fases 2 e 3)

| Extensão | Onde encaixa |
| --- | --- |
| SSO corporativo (OIDC/SAML) | Nova rota em `server/routes/auth.ts`, que cria a sessão com o mesmo `createSession`. O cadastro por convite e o MFA podem ser delegados ao provedor. |
| Vídeos e áudios hospedados | Hoje são links `https` externos (`contents.external_url`). Para streaming protegido, um novo tipo de armazenamento com URLs de curta duração por sessão, autorizadas pela mesma política. |
| CRM e indicadores comerciais | A seção "Resultados comerciais" de `/api/admin/reports/overview` já está reservada. A integração cruza a data de conclusão das trilhas com eventos do CRM, sem presumir causalidade. |
| Matriz de competências e PDI | `practical_activities.competency` e o feedback do tipo "plano de desenvolvimento" são o ponto de partida. |
| Sugestão de questões e conteúdos com IA | O banco de questões e o texto extraído das páginas (`document_pages.text`) já existem. A sugestão deve passar por revisão humana antes de publicar. |
| Antivírus e conversão | `server/services/documents/malware.ts` e `docx.ts`, ativados por variáveis de ambiente. |

## Modo demonstração

`vite build --mode demo` gera um pacote com uma API simulada (`web/src/demo/`). Ela reproduz respostas gravadas do servidor real (`tools/demo/record.cjs`) e roteia por hash. `tools/demo/build-html.mjs` junta tudo em um único HTML. O build de produção não inclui esse código.
