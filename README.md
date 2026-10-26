# LIFE CLASS

Universidade corporativa do Grupo Life Brasil: trilhas de formação, apostilas protegidas, exercícios, avaliações, aplicação prática acompanhada pelo líder e indicadores de capacitação.

O visual segue o "Modelo Life" do simulador de consórcio do Grupo Life Brasil: preto ou branco com o laranja Life, fonte Klavika (Titillium Web quando a Klavika não está instalada), títulos em caixa alta com a palavra-chave em laranja, cartões de cantos arredondados e botões em pílula. O tema acompanha o sistema de cada pessoa (claro ou escuro), e o contraste segue o WCAG AA.

Esta é a **Fase 1 (MVP operacional)**: autenticação real, banco de dados relacional, regras de permissão verificadas no servidor e persistência de todo o histórico. Os dados de demonstração são fictícios.

- Arquitetura, modelo de dados e segurança: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Requisitos implementados, pendentes e dependentes de infraestrutura: [`docs/REQUISITOS.md`](docs/REQUISITOS.md)
- Capturas de tela (computador e celular): [`docs/capturas/`](docs/capturas)
- **Publicar na Vercel** (banco Neon, arquivos no Vercel Blob privado, produção vazia): [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md)
- **Roteiro para subir os materiais de apoio** pelo painel: [`docs/PUBLICAR-MATERIAIS.md`](docs/PUBLICAR-MATERIAIS.md)

## Experimentar sem instalar

[`docs/demo/life-class-demo.html`](docs/demo/life-class-demo.html) é a aplicação real em um único arquivo, sem servidor: baixe e abra no navegador. Use os botões no canto inferior direito para entrar como **Colaborador**, **Líder** ou **Administrador**.

As respostas foram gravadas do sistema em funcionamento, com os dados fictícios do seed. A navegação, as telas, o leitor com marca d'água e os painéis são os mesmos do sistema. As alterações (salvar, publicar, enviar avaliação) são apenas simuladas, e downloads e exportações só funcionam na aplicação instalada.

Para gerar de novo: `npm run seed`, servidor em execução, `npm run demo:record` e `npm run demo:build` (a gravação usa o Playwright).

## Acesso de colaboradores

- **Convite e primeiro acesso:** o administrador convida. Em Configurações › Primeiro acesso, define se o primeiro acesso é obrigatório e se novos convites aguardam liberação depois da ativação (ajustável em cada convite).
- **Liberação:** quem aguarda liberação faz o primeiro acesso, mas só estuda depois que um administrador libera em Usuários. Os administradores são avisados.
- **Desligamento:** na ficha do usuário, imediato ou agendado, com motivo. Tranca o acesso, encerra sessões, invalida links e remove lideranças, preservando o histórico.
- **Líderes** acompanham, atribuem e validam, mas não alteram áreas, trilhas, conteúdos nem o banco de questões. Isso é exclusivo do administrador.

## Rodar localmente

Requisitos: Node.js 22 ou superior. O PostgreSQL é opcional em desenvolvimento, porque sem `DATABASE_URL` é usado um PostgreSQL embutido (PGlite) em `data/`.

```bash
npm install
npm run seed      # cria áreas, trilhas, apostilas, avaliações e usuários fictícios
npm run dev       # API em :3001 e interface em http://localhost:5173
```

O seed gera senhas aleatórias e grava as credenciais em `data/demo-credentials.txt`. Esse arquivo fica fora do Git e não existe senha fixa no código. Administradores e líderes configuram a verificação em duas etapas no primeiro login, com um aplicativo autenticador como Google Authenticator, Microsoft Authenticator ou 1Password.

## Produção na Vercel

O repositório já vem pronto para a Vercel (`vercel.json`, função `api/index.js`, rotina diária e cabeçalhos de segurança). Em resumo:
1. importe o projeto;
2. conecte o banco Neon e uma loja **privada** do Vercel Blob pelo menu Storage;
3. cadastre `APP_SECRET`, `CRON_SECRET` e `SETUP_TOKEN`;
4. publique;
5. crie o primeiro administrador em `/configuracao-inicial`.

A produção começa **vazia**: sem usuários, áreas ou conteúdos fictícios. O passo a passo completo está em [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md).

## Produção em servidor próprio

1. Provisionar o PostgreSQL, um bucket S3 privado (ou compatível), SMTP e um proxy reverso com HTTPS. ClamAV e LibreOffice são opcionais.
2. Copiar `.env.example` para `.env` (ou definir as variáveis no orquestrador). `APP_SECRET` e `DATABASE_URL` são obrigatórios.
3. Gerar o build e iniciar o servidor:

   ```bash
   npm ci
   npm run build
   npm start          # aplica as migrações e serve API e interface na mesma porta
   ```

4. Criar o primeiro administrador. O comando imprime um link de convite de uso único:

   ```bash
   npm run admin:create -- --email pessoa@empresa.com.br --name "Nome Completo"
   ```

5. Configurar backup do banco e do bucket e o monitoramento de erros. Esses itens são de infraestrutura e estão listados em `docs/REQUISITOS.md`.

O painel administrativo (Segurança e privacidade › Ambiente) mostra o que está configurado: banco, armazenamento, SMTP, antivírus, conversão de DOCX e cookies seguros.

## Scripts

| Comando | Para quê |
| --- | --- |
| `npm run dev` | API e interface com recarga automática |
| `npm run build` / `npm start` | Verificação de tipos, build e servidor de produção |
| `npm test` | Testes automatizados (autenticação, autorização, critérios de aceitação e unidades) |
| `npm run typecheck` | Verificação de tipos do front-end e do servidor |
| `npm run db:migrate` | Aplica as migrações (o servidor também aplica ao iniciar) |
| `npm run db:generate` | Gera uma nova migração a partir de `server/db/schema.ts` |
| `npm run seed` | Dados fictícios de demonstração (só em banco vazio; recusado em produção) |
| `npm run admin:create` | Cria o primeiro administrador por convite |
| `npm run audit:purge` | Aplica a política de retenção agora (também roda diariamente) |
| `npm run demo:record` / `npm run demo:build` | Gera a demonstração em HTML único |
| `npm run vercel-build` | Build usado pela Vercel: verificação de tipos, interface, servidor e migrações |

## Estrutura

```
api/               função da Vercel (encaminha /api/* para o servidor)
server/            API (Fastify + Drizzle)
  auth/            senhas (Argon2id), sessões, MFA (TOTP), tokens de convite e redefinição
  authz/           avaliação de permissões (negação por padrão)
  routes/          rotas do colaborador, do líder e do administrador (admin/)
  services/        trilhas e progresso, avaliações, documentos (PDF), notificações, retenção
  db/              esquema, cliente e migrações
  scripts/         seed, migração, criação de administrador, retenção
shared/            tipos, rótulos e regras usados pelo servidor e pela interface
web/src/           interface (React + Tailwind)
  pages/           telas do colaborador (learner), do líder (leader), do administrador (admin) e de acesso (auth)
  demo/            modo demonstração (somente no build de demonstração)
tests/             testes automatizados (Vitest)
tools/demo/        gravação e montagem da demonstração em HTML
docs/              arquitetura, requisitos, capturas e demonstração
```

## Testes

```bash
npm test
```

São 69 testes, que rodam com um banco em memória novo a cada arquivo:
- autenticação, sessões, CSRF, MFA, convite, recuperação de senha e bloqueio de conta;
- autorização e isolamento de dados (URL direta, API, troca de identificadores, líder fora do escopo e sem edição de conteúdo);
- liberação após o primeiro acesso, primeiro acesso opcional, desligamento imediato e agendado, capa e arquivo da biblioteca;
- implantação na Vercel: configuração inicial do primeiro administrador, rotina diária protegida por segredo, envio direto de arquivos grandes e download por link assinado;
- os critérios de aceitação 1 a 14 da especificação;
- regras puras: correção de questões, tempo de leitura, CSV e política de senha.

O critério 15 (celular e computador) foi verificado no navegador. As capturas estão em `docs/capturas/`.
