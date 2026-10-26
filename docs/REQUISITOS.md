# Situação dos requisitos — Fase 1

Atualizado com o código deste repositório. Três listas, conforme pedido na especificação:

- **A. Implementados:** funcionam na aplicação e, quando indicado, são cobertos por testes automatizados.
- **B. Pendentes:** ainda não construídos ou construídos só em parte. A maioria é das fases 2 e 3.
- **C. Dependem de infraestrutura, integração ou configuração:** o código está pronto, mas precisam de serviço externo, decisão da empresa ou conteúdo oficial.

## A. Implementados

### Acesso e segurança
- Login corporativo com mostrar/ocultar senha, estados de carregamento e erro e layout responsivo. Visual escuro com painel institucional, como nas referências.
- Cadastro **apenas por convite**: link pessoal, de uso único e com validade, sem cadastro público. Há também o comando `admin:create` para o primeiro administrador, sem senha fixa no código.
- Senhas com Argon2id e política de senha (mínimo configurável, letras e números, sem nome, e-mail ou datas, sem senhas comuns, sem repetir as 5 últimas).
- Recuperação de senha com resposta genérica e link de uso único que revoga as sessões. O administrador também pode gerar o link quando não há SMTP.
- **MFA (TOTP)** obrigatório para administradores e líderes, opcional para colaboradores, com 8 códigos de recuperação e proteção contra reutilização de código.
- Bloqueio por tentativas excessivas, limite de requisições nas rotas sensíveis e no leitor, e a mesma resposta para e-mails existentes e inexistentes.
- Sessões em cookie HttpOnly, Secure e SameSite=Strict, com expiração por inatividade e absoluta. Listagem e encerramento das próprias sessões e de qualquer sessão pelo administrador.
- Nenhum token no `localStorage`. O token CSRF fica só em memória, e há checagem de origem.
- Negação por padrão em toda a API e autorização no servidor a cada operação. Trocar o identificador na URL não expõe dados de outro usuário.
- Desativar o usuário encerra as sessões e o acesso na hora.
- CSP, HSTS, `noindex` e `robots.txt`, proteção contra injeção de fórmulas em CSV e validação de toda entrada.
- Auditoria **somente inclusão**, garantida no banco, com filtros e exportação.

### Perfis e permissões
- Três perfis: **administrador geral**, **líder de área** e **colaborador**.
- Regras de liberar ou bloquear por **usuário, cargo, equipe, departamento, perfil ou todos**, nos níveis **área, trilha, módulo e documento**, com validade opcional. O bloqueio sempre prevalece.
- Acesso parcial à trilha, trilhas livres, obrigatórias, opcionais e dependentes, e sequência entre módulos e conteúdos.
- Escopo do líder: áreas (com permissão de editar ou publicar definida pelo administrador) e equipes. Ele atribui trilhas, define prazos, libera ou bloqueia trilhas da sua área para a sua equipe, corrige, valida e registra feedback, sem ver outras equipes nem conceder mais do que recebeu.
- Ferramentas de verificação: "este usuário pode acessar?" (com o motivo) e "quem tem acesso a este recurso?".
- Atribuição em massa de trilhas por cargo, equipe, departamento, perfil ou todos.

### Experiência do colaborador
- **Primeiro acesso em 5 etapas:** boas-vindas, como usar, termos com ciência registrada (data e versão), minha jornada e "Iniciar minha capacitação". As instruções ficam disponíveis no menu Ajuda.
- **Painel:**
  - saudação, cargo e área;
  - próxima atividade recomendada com "Continuar de onde parei" (retoma na página);
  - trilhas obrigatórias e em andamento, evolução e tempo restante estimado;
  - prazos, avaliações pendentes, conteúdos recentes, certificados e recomendações de leitura.
- **Catálogo de áreas e de trilhas** com capa, nível, módulos, duração, progresso, status e pré-requisitos. Filtros por área, especialidade, cargo, nível, status e obrigatoriedade. Conteúdo sem permissão aparece **bloqueado com pedido de acesso** ou fica **oculto**, conforme a configuração.
- Os seis status de trilha da especificação e os quatro pilares: estudado, avaliado, demonstrado e aplicado/validado.
- **Leitor protegido:**
  - páginas renderizadas no servidor com **marca d'água individual** (nome, identificador, data e hora, sessão);
  - sem o arquivo original no navegador e sem download ou impressão pela interface;
  - registro de abertura, conclusão e tentativas de copiar, salvar e imprimir;
  - sumário, zoom, tela cheia e marcadores;
  - **modo texto acessível**, que também exige permissão.
- **Tempo de leitura:**
  - estimado com 200 palavras/min configurável por plataforma e por área, fator de complexidade e ajuste manual;
  - medição de tempo de visualização separada do tempo de leitura ativa, com pausa por inatividade;
  - progresso por página e conclusão por percentual lido.
- Anotações privadas, dúvidas privadas, destaques, marcadores e comentários compartilhados com resposta do líder (podem ser desativados por área ou conteúdo). Exportação e exclusão das próprias anotações.
- **Avaliações:**
  - tipos: múltipla escolha (uma ou várias), verdadeiro ou falso, associação, ordenação, cálculo e discursiva;
  - nota mínima de 80% configurável, tentativas, tempo limite, embaralhamento e sorteio de questões;
  - devolutiva completa ou só a nota, e correção manual pelo líder.
- **Da teoria à prática:** atividades de demonstrar e executar com entrega, validação ou devolução pelo líder e validação final da trilha. Ficam separados os estados estudado, avaliado, demonstrado e validado.
- Trilha de rampagem de 7 dias, minha evolução e certificados com código.
- Biblioteca com regras de direito autoral: obras sem licença entram só como indicação, com link oficial.
- Notificações internas com deduplicação, e-mail opcional e preferência de cada pessoa.
- Perfil com exportação dos próprios dados (LGPD).

### Líder
- Painel da equipe com conclusão, obrigatórias pendentes, atrasos, validações pendentes, colaboradores com dificuldade e competências validadas, além da evolução mensal e do relatório em CSV.
- Ficha do colaborador, atribuição de trilhas e prazos, feedback, recomendação e plano de desenvolvimento.
- Fila de validações (atividades e correções), dúvidas das trilhas e solicitações de acesso e de conteúdo.
- O painel informa o que **não** é monitorado: horários de uso, tempo de tela e anotações pessoais.

### Administração
- Painel com pendências e alertas de configuração.
- Usuários e convites, organização (departamentos, equipes, cargos) e escopo dos líderes.
- **Áreas e trilhas:**
  - criar, editar, ocultar e reordenar áreas, trilhas, módulos, conteúdos, avaliações e atividades;
  - fluxo editorial rascunho → revisão → publicado → arquivado, com histórico de alterações;
  - **upload de PDF e DOCX com versões**: prévia protegida, ativação da versão, aviso aos matriculados em atualização relevante e progresso preservado;
  - verificação de formato e de riscos no PDF.
- Banco de questões com reutilização, resultados por avaliação e índice de acerto por questão.
- Permissões, atribuição em massa e verificação de acesso.
- **Indicadores:**
  - engajamento: ativos, iniciadas, concluídas, abandono e evolução mensal;
  - aprendizagem: médias, aprovação, tentativas, avaliações e questões mais difíceis, pendências;
  - desenvolvimento: competências demonstradas, aplicações validadas, dias até concluir e até a primeira execução supervisionada, por cargo e por área;
  - exportações em CSV.
- Auditoria com filtros e CSV, sessões ativas, política de sessão e senha, versões dos termos, retenção (LGPD) e status do ambiente.
- Identidade visual configurável sem alterar código: nome, frase, cores com verificação de contraste, fontes, logotipo e modo claro ou escuro (claro como padrão, cada pessoa pode trocar).

### Dados e qualidade
- Modelo relacional com 43 tabelas, cobrindo todas as entidades da seção 22, com migrações versionadas.
- Progresso, anotações e tentativas persistem após logout.
- Dados fictícios de demonstração: áreas A–H com as trilhas da especificação, espaço para a trilha de Planejamento Financeiro M0–M9 sem alterar o original e usuários com senhas aleatórias.
- 56 testes automatizados e verificação de tipos, além da demonstração em HTML único (`docs/demo`).

### Critérios de aceitação (seção 26)

| # | Critério | Evidência |
| --- | --- | --- |
| 1 | Administrador cria colaborador e envia convite seguro | Teste `acceptance` 1 |
| 2 | Colaborador conclui o primeiro acesso | Teste `acceptance` 2 |
| 3 | Administrador cria área, trilha e módulo | Teste `acceptance` 3 |
| 4 | Administrador publica uma apostila | Teste `acceptance` 4 |
| 5 | Colaborador autorizado lê a apostila | Teste `acceptance` 5 |
| 6 | Não autorizado não acessa, nem por URL direta ou API | Teste `acceptance` 6 e testes de `authorization` |
| 7 | Original protegido sem URL pública | Teste `acceptance` 7 |
| 8 | Registro e recuperação do progresso de leitura | Teste `acceptance` 8 |
| 9 | Criar e recuperar anotações | Teste `acceptance` 9 |
| 10 | Realizar avaliação e consultar o resultado | Teste `acceptance` 10 |
| 11 | Líder acompanha e valida atividades | Teste `acceptance` 11 |
| 12 | Administrador altera permissões e revoga acessos | Teste `acceptance` 12 |
| 13 | Desativado perde sessões e conteúdos | Teste `acceptance` 13 e teste de `auth` |
| 14 | Dados persistem após logout e novo login | Teste `acceptance` 14 |
| 15 | Funciona em celular e computador | Verificado no navegador. Capturas em `docs/capturas` (sufixo `-mobile`) |
| 16 | Testes de autorização e isolamento passam | `npm test` (todos passando) |

### Telas obrigatórias (seção 24)

| # | Tela | Rota |
| --- | --- | --- |
| 1 | Login | `/entrar` |
| 2 | Recuperação de acesso | `/recuperar-acesso`, `/redefinir-senha/:token` |
| 3 | Primeiro acesso e boas-vindas | `/convite/:token`, `/primeiro-acesso`, `/primeiro-acesso/manual` |
| 4 | Dashboard do colaborador | `/` |
| 5 | Catálogo de áreas | `/areas` |
| 6 | Catálogo de trilhas | `/trilhas` |
| 7 | Detalhe da trilha | `/trilhas/:id` |
| 8 | Detalhe do módulo | `/modulos/:id` |
| 9 | Visualizador protegido | `/conteudos/:id` |
| 10 | Anotações e comentários | painéis do leitor e `/anotacoes` |
| 11 | Exercícios e avaliações | `/avaliacoes/:id`, `/avaliacoes/:id/tentativas/:tentativa` |
| 12 | Resultado e feedback | resultado da tentativa; feedback em `/minha-evolucao` |
| 13 | Minha evolução | `/minha-evolucao`, `/certificados/:codigo` |
| 14 | Biblioteca | `/biblioteca` |
| 15 | Dashboard do líder | `/lider` |
| 16 | Gestão da equipe | `/lider/equipe/:id`, `/lider/validacoes`, `/lider/duvidas`, `/lider/solicitacoes` |
| 17 | Painel do administrador | `/admin` |
| 18 | Cadastro de usuários | `/admin/usuarios`, `/admin/organizacao` |
| 19 | Áreas e trilhas | `/admin/conteudos`, `/admin/trilhas/:id` |
| 20 | Upload e publicação | `/admin/conteudos/:id`, `/admin/avaliacoes/:id`, `/admin/questoes` |
| 21 | Permissões | `/admin/permissoes` |
| 22 | Relatórios e auditoria | `/admin/relatorios`, `/admin/auditoria` |
| 23 | Configurações gerais | `/admin/configuracoes`, `/admin/seguranca`, `/admin/biblioteca` |

## B. Pendentes

| Item | Situação |
| --- | --- |
| Login corporativo (SSO) | Não implementado. O ponto de integração está descrito em `ARQUITETURA.md`. |
| Vídeos, gravações e áudios hospedados com proteção | Parcial: hoje são links `https` externos (a plataforma de vídeo controla o acesso). Streaming próprio é da fase 2. |
| Avaliações multimídia e estudos de caso avançados | Fase 2. Hoje o estudo de caso usa contexto em texto e resposta discursiva. |
| Integração com CRM e indicadores comerciais | Fase 3. A seção está reservada nos relatórios, com aviso sobre correlação e causalidade. |
| Matriz de competências e PDI completos | Parcial: competência por atividade e feedback do tipo "plano de desenvolvimento". A matriz é da fase 3. |
| Recomendações personalizadas e sugestões de conteúdo com IA | Fase 3. |
| Identificação automática de dificuldades de aprendizado | Parcial: o painel do líder sinaliza colaboradores com atraso ou nota baixa e os relatórios mostram as questões com mais erros. Modelos preditivos são da fase 3. |
| Testes ponta a ponta no CI | Os fluxos foram verificados no navegador com scripts locais, mas ainda não rodam no CI. |
| Impedimento absoluto de capturas de tela | **Não é possível na web** e não é prometido. A marca d'água individual dissuade e permite rastrear vazamentos. |

## C. Dependem de infraestrutura, integração ou configuração

| Item | O que é preciso |
| --- | --- |
| Banco de produção | PostgreSQL gerenciado com backup automático e testes de restauração (`DATABASE_URL`). |
| Armazenamento privado | Bucket S3 (ou compatível) privado, com bloqueio de acesso público e criptografia (`STORAGE_DRIVER=s3`). |
| HTTPS | Certificado e proxy reverso ou balanceador (`TRUST_PROXY=true`). |
| E-mail | SMTP corporativo (`SMTP_*`). Sem ele, convites e links de redefinição aparecem para o administrador. |
| Antivírus nos uploads | Serviço ClamAV (`CLAMAV_HOST`). Sem ele, os arquivos passam só pela validação de formato e de riscos do PDF. |
| Conversão de DOCX | LibreOffice instalado no servidor (`SOFFICE_PATH`). Sem ele, as apostilas devem ser enviadas em PDF. |
| Mais de uma instância do servidor | Limite de requisições em Redis e fila externa para processar documentos (ver `ARQUITETURA.md`). |
| Monitoramento e alertas | Ferramenta de erros e métricas (Sentry, Datadog ou similar) e alertas de disponibilidade. |
| Backups e plano de continuidade | Rotina e responsáveis definidos pela TI. |
| Atualização de dependências | Rotina de `npm audit` e atualização (o CI já roda testes e build a cada envio). |
| Identidade visual oficial | Logotipo, cores e fontes do Grupo Life Brasil, que entram pela tela de Configurações sem alterar código. |
| Conteúdo oficial | Apostilas, avaliações e a trilha de Planejamento Financeiro M0–M9. A estrutura já está criada, e os módulos M0–M9 aguardam os arquivos originais. |
| Termos, privacidade e LGPD | Texto jurídico dos termos e do aviso de privacidade, o encarregado (DPO), os papéis de controlador e operador e o procedimento de incidentes. A plataforma versiona os termos e registra a ciência, e `ARQUITETURA.md` traz uma proposta de procedimento. |
| Prazos de retenção | Validar com o jurídico os padrões configurados: auditoria 730 dias, sessões de leitura 365 e notificações 180. |
