# Publicar o LIFE CLASS na Vercel

Este guia leva a plataforma do repositório para o ar na Vercel. Ao final, ela fica com:
- banco PostgreSQL da Neon;
- armazenamento privado de arquivos no Vercel Blob;
- uma rotina diária;
- o banco **vazio**: o primeiro administrador é criado por você e os materiais entram pelo painel (veja `docs/PUBLICAR-MATERIAIS.md`).

Nenhum dado fictício vai para produção. O seed de demonstração só roda em desenvolvimento e é recusado em produção.

## Antes de começar

- **Plano da Vercel.** O plano Hobby é só para uso pessoal e não comercial. Uma plataforma corporativa precisa do plano **Pro**.
- **Repositório.** O repositório `GLB_HubClass` precisa estar no GitHub. Hoje ele tem uma única branch, `claude/magical-lamport-rv0j50`, e é ela que a Vercel publica como produção. Se depois for criada uma branch `main`, ajuste em **Settings → Git → Production Branch**.
- **Segredos.** Gere três valores aleatórios e guarde-os num cofre de senhas. Este comando gera um valor por vez:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

  - `APP_SECRET`: protege as chaves de verificação em duas etapas. **Não troque depois**, porque isso invalida as chaves já cadastradas.
  - `CRON_SECRET`: autoriza a rotina diária.
  - `SETUP_TOKEN`: código de uso único para criar o primeiro administrador.

## Passo a passo

### 1. Importar o projeto

1. Entre em [vercel.com](https://vercel.com) com a conta do GitHub, em **Continue with GitHub**. Se já tiver conta, conecte o GitHub em **Account Settings → Authentication**.
2. No painel, clique em **Add New… → Project**.
3. Em **Import Git Repository**, encontre `GLB_HubClass` e clique em **Import**. Se ele não aparecer:
   - clique em **Adjust GitHub App Permissions** (ou **Configure GitHub App**);
   - no GitHub, em *Repository access*, marque `GabrielBava/GLB_HubClass` e salve;
   - volte para a Vercel; o repositório passa a aparecer na lista.
4. Na tela **Configure Project**:
   - **Project Name**: por exemplo `life-class`; vira o endereço `life-class.vercel.app`;
   - **Framework Preset**: **Other**;
   - **Root Directory**: deixe `./`;
   - **Build and Output Settings**: não altere. O `vercel.json` já define a instalação (`npm ci`), o build (`npm run vercel-build`), a pasta da interface (`dist/web`), a função da API (`api/index.js`), a rotina diária e os cabeçalhos de segurança;
   - **Environment Variables**: dá para cadastrar aqui `APP_SECRET`, `CRON_SECRET` e `SETUP_TOKEN` (veja o passo 4) ou depois, em Settings.
5. Clique em **Deploy**. O primeiro deploy termina mesmo sem banco. Ao abrir o site, a tela de login avisa "Plataforma ainda não configurada" e lista o que falta. Siga os passos 2 a 5.

### 2. Banco de dados (Neon)

1. No projeto, abra **Storage → Create Database → Neon (Serverless Postgres)**.
2. Escolha a região **mais próxima do Brasil** disponível e conecte ao projeto, nos ambientes Production, Preview e Development.
3. A integração cria as variáveis `DATABASE_URL` (com pooler) e `DATABASE_URL_UNPOOLED`.

O build aplica as migrações automaticamente, pela conexão direta. Sem banco conectado, o build apenas avisa e segue. Ative o **Preview Branching** da Neon se quiser que as prévias usem uma cópia isolada do banco.

### 3. Armazenamento de arquivos (Vercel Blob privado)

1. Abra **Storage → Create → Blob**.
2. Em **Access**, escolha **Private**. Esse modo não pode ser alterado depois. Uma loja pública deixaria as apostilas acessíveis por link e não deve ser usada.
3. Conecte a loja **somente ao ambiente Production**. Para testar prévias, crie uma segunda loja privada e conecte só ao Preview. Assim, uma prévia nunca grava na loja de produção.

A plataforma detecta a Vercel e usa o Blob privado sozinha. A credencial vem da integração: OIDC do projeto ou `BLOB_READ_WRITE_TOKEN`.

### 4. Variáveis de ambiente

Abra **Settings → Environment Variables** e cadastre:

| Variável | Valor | Ambientes |
| --- | --- | --- |
| `APP_SECRET` | segredo gerado (48 bytes) | Production (e outro valor em Preview) |
| `CRON_SECRET` | segredo gerado | Production |
| `SETUP_TOKEN` | segredo gerado | Production |
| `APP_ORIGIN` | `https://seu-dominio.com.br`, só com domínio próprio | Production |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | e-mail corporativo (Google Workspace, Microsoft 365, Resend…) | Production |
| `CLAMAV_HOST`, `CLAMAV_PORT` | antivírus externo, opcional | Production |

Sem `APP_ORIGIN`, vale o domínio de produção da Vercel (`seu-projeto.vercel.app`).

Sem SMTP, a plataforma funciona normalmente. Os links de convite e de redefinição de senha aparecem para o administrador enviar por um canal seguro.

### 5. Publicar de novo

Variáveis novas e bancos conectados só valem para os **próximos** deploys. Abra **Deployments**, clique nos três pontos do deploy mais recente e escolha **Redeploy**.

O build segue esta ordem:
1. verifica os tipos;
2. compila a interface e o servidor;
3. cria as tabelas no Neon.

Para conferir, abra o log do build e procure "Migrações aplicadas (PostgreSQL)". Se aparecer "AVISO: banco de dados não conectado", o Neon do passo 2 não está ligado ao ambiente desse deploy (Production ou Preview).

### 6. Primeiro administrador

Há duas formas. Escolha uma.

**A. Pelas variáveis de ambiente, criado no próprio deploy.**
1. Em **Settings → Environment Variables** (ambiente Production), cadastre:
   - `BOOTSTRAP_ADMIN_EMAIL`: o e-mail do administrador;
   - `BOOTSTRAP_ADMIN_PASSWORD`: a senha inicial, com pelo menos 10 caracteres, letras e números. Marque como **Sensitive**;
   - `BOOTSTRAP_ADMIN_NAME`: opcional; sem ele, o nome sai do e-mail.
2. Faça **Redeploy**. Logo após criar as tabelas, o build cria o administrador já ativo. No log aparece "Administrador … criado". Se a senha não seguir toda a política (por exemplo, por ter datas), o log mostra um aviso.
3. Entre com esse e-mail e senha. No primeiro login, a plataforma pede a verificação em duas etapas.
4. Depois do primeiro login, **apague as variáveis `BOOTSTRAP_ADMIN_*`**. Elas só agem enquanto não existe administrador, então os próximos deploys não mudam nada, mas não precisam ficar guardadas.

**B. Pela tela de configuração inicial.**

1. Abra `https://seu-projeto.vercel.app/configuracao-inicial`. A tela de login também mostra o atalho enquanto não houver administrador.
2. Informe o `SETUP_TOKEN`, o nome e o e-mail corporativo do administrador.
3. Abra o link de convite, crie a senha e configure a verificação em duas etapas no aplicativo autenticador. Guarde também os códigos de recuperação.
4. A tela de configuração inicial se desativa sozinha quando existe um administrador. Se quiser, apague o `SETUP_TOKEN` das variáveis.

### 7. Primeiros ajustes no painel

1. Em **Segurança e privacidade → Termos de uso**, publique os termos de uso e confidencialidade, com o texto aprovado pelo jurídico.
2. Em **Configurações**, revise:
   - a identidade visual;
   - o primeiro acesso (obrigatório ou não, liberação após o convite);
   - os prazos de retenção.
3. Siga `docs/PUBLICAR-MATERIAIS.md` para montar as áreas e trilhas e publicar as apostilas.

### 8. Domínio próprio (opcional)

1. Em **Settings → Domains**, adicione o domínio, por exemplo `lifeclass.grupolifebrasil.com.br`, e configure o DNS indicado.
2. Atualize `APP_ORIGIN` com o novo endereço e faça um novo deploy.

## Como a plataforma se comporta na Vercel

- **Arquivos grandes.**
  - As funções da Vercel aceitam até 4,5 MB por requisição.
  - Acima de 4 MB, o navegador do administrador envia o PDF direto para o Blob privado, com um link assinado de uso único. Depois a plataforma confere e processa o arquivo.
  - Downloads acima de 4 MB saem por um link assinado válido por 5 minutos, emitido só para quem tem permissão e registrado na auditoria.
- **Processamento das apostilas.**
  - Acontece no próprio envio, com limite de 300 segundos por requisição. Isso é suficiente para apostilas comuns.
  - Documentos muito longos, com várias centenas de páginas, devem ser divididos em partes.
  - Se um processamento for interrompido, a rotina diária retoma.
- **Rotina diária**, às 03h17 de Brasília:
  - aplica a política de retenção;
  - executa desligamentos agendados (o login e as sessões já são recusados no horário exato);
  - retoma documentos pendentes;
  - apaga envios temporários abandonados.
- **DOCX.** A Vercel não tem LibreOffice, então as apostilas devem ser enviadas em **PDF**.
- **Antivírus.** Opcional, com um serviço ClamAV externo (`CLAMAV_HOST`). Sem ele, os arquivos passam pela validação de formato e de itens ativos do PDF.
- **Limite de tentativas.** É por instância da função. O bloqueio de conta após falhas de login fica no banco e vale para todas.

## Backup e continuidade

- **Banco.** A Neon oferece restauração para um ponto no tempo, conforme o plano contratado. Defina a janela de retenção com a TI.
- **Arquivos.** O Blob não tem backup automático entre lojas. Para uma cópia de segurança, a TI pode agendar a exportação periódica da loja com o SDK `@vercel/blob` (`list` e `get`).
- **Monitoramento.** Em **Logs** e **Observability**, acompanhe erros da função e a execução da rotina diária, em **Settings → Cron Jobs**.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `Command "npm run vercel-build" exited with 1` | Veja a primeira linha em vermelho do log de build (Deployments › deploy › **Building**). | Siga as linhas abaixo conforme a mensagem. |
| Log com "Falha ao aplicar as migrações no banco" | O Neon não aceitou a conexão: banco pausado ou removido, ou variáveis antigas. | Em Storage, confira se o Neon está ligado ao ambiente do deploy e faça **Redeploy**. |
| Log com `tsc: not found` ou `vite: not found` | Existe uma variável `NODE_ENV=production` cadastrada, e as ferramentas de build não foram instaladas. | Apague `NODE_ENV` das variáveis; a Vercel e a plataforma já tratam o ambiente. Faça **Redeploy**. |
| Login mostra "Plataforma ainda não configurada" | Falta `APP_SECRET` ou o banco (a mensagem diz qual). | Cadastre ou conecte o que falta e faça **Redeploy**. |
| Envio de PDF grande falha | Loja Blob ausente, pública ou não conectada à produção. | Crie a loja como **Private** e conecte ao ambiente Production; faça **Redeploy**. |

## Desenvolvimento local

Nada muda: `npm run dev` usa o banco embutido e o disco local, e `npm run seed` cria dados fictícios só na sua máquina.

Para testar contra o banco da Vercel, use `vercel env pull .env` e depois `npm run dev`. Cuidado: assim você grava no banco real.
