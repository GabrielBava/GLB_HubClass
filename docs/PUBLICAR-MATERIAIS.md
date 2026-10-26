# Roteiro para publicar os materiais de apoio

Este roteiro é para o administrador. Ele leva a plataforma vazia até as primeiras pessoas estudando. Faça os passos na ordem: cada um depende do anterior.

## Antes de subir: prepare os arquivos

- **Formato.** As apostilas entram em **PDF**. Na Vercel não há conversão de Word; exporte para PDF antes.
- **Tamanho.**
  - Até 80 MB por arquivo; o limite pode ser ajustado em Segurança e privacidade.
  - Arquivos acima de 4 MB são enviados direto ao armazenamento privado, sem nenhum passo extra.
- **Documentos longos.** Acima de cerca de 300 páginas, divida em partes. Cada parte vira um conteúdo do módulo.
- **Sumário.** PDFs com marcadores (bookmarks) geram o sumário lateral automaticamente. Sem marcadores, a plataforma usa os títulos detectados nas páginas.
- **Planilha de organização.** Monte uma planilha simples antes de começar:

| Área | Trilha | Tipo da trilha | Módulo | Conteúdo (arquivo) | Avaliação | Público |
| --- | --- | --- | --- | --- | --- | --- |
| Planejamento Financeiro | Formação de Planejador Financeiro | Obrigatória | M0 — Introdução | M0-introducao.pdf | Exercício de fixação | Planejadores |
| … | … | … | M1 … M9 | … | … | … |

## 1. Base da plataforma

1. **Termos de uso**, em *Segurança e privacidade → Termos de uso*:
   - publique o texto de uso e confidencialidade aprovado;
   - todos registram ciência no primeiro acesso.
2. **Organização**, em *Organização*:
   - cadastre departamentos, equipes e cargos;
   - eles são usados para liberar trilhas e atribuir em massa.
3. **Configurações → Primeiro acesso**:
   - defina se o primeiro acesso é obrigatório;
   - defina se novos convites aguardam sua liberação.

## 2. Estrutura do catálogo

Tudo isso fica em *Áreas e trilhas*.

1. **Área de conhecimento.** Crie as áreas (ex.: Planejamento Financeiro, Consórcios, Seguros e Proteção) com nome, ícone e cor.
2. **Trilha.** Dentro da área, preencha título, resumo, objetivos, nível, capa e o tipo:
   - **Obrigatória**: atribuída a cargos ou equipes, aparece em "Trilhas obrigatórias".
   - **Opcional**: disponível para quem tiver acesso.
   - **Livre**: aberta a todos os colaboradores ativos.
   - **Dependente de etapa anterior**: só abre depois de concluir outra trilha.
3. **Módulos.** Crie na ordem em que serão estudados (ex.: M0 a M9). Marque "Depende da conclusão do módulo anterior" quando a sequência importar.

## 3. Conteúdos e apostilas

1. No módulo, adicione um conteúdo do tipo **Apostila (PDF)** e dê o título.
2. Em **Enviar nova versão**, escolha o PDF e escreva uma nota curta (ex.: "Versão inicial").
3. Aguarde o processamento: a plataforma extrai o texto, monta o sumário e gera as páginas protegidas com marca d'água. O quadro "Arquivo protegido" mostra páginas, palavras e o tempo estimado de leitura.
4. Use **Ver como colaborador** para conferir a leitura.
5. Para atualizar uma apostila depois, envie uma nova versão:
   - o progresso de quem já leu é preservado;
   - marque "Atualização relevante" para avisar quem está matriculado.

Vídeos, áudios e links externos entram como conteúdos dos tipos correspondentes, com o link da plataforma de origem.

## 4. Exercícios, avaliações e prática

1. **Banco de questões.** Cadastre as questões por área: múltipla escolha, verdadeiro ou falso, associação, ordenação, cálculo ou discursiva.
2. **Avaliações.** No módulo ou ao final da trilha, crie exercícios de fixação e avaliações. Defina:
   - a nota mínima (padrão 80%);
   - o número de tentativas e o tempo;
   - o tipo de devolutiva.
3. **Da teoria à prática.** Adicione atividades de "Demonstrar" (simulação ou estudo de caso) e "Executar" (aplicação real), com validação do líder quando necessário.

## 5. Publicar

Os itens seguem o fluxo **Rascunho → Em revisão → Publicado**. Publique nesta ordem:
1. o conteúdo;
2. o módulo;
3. a trilha.

Só o que está publicado em toda a cadeia aparece para os colaboradores. O histórico de alterações fica registrado.

## 6. Liberar e atribuir

1. Em *Permissões → Atribuição em massa*, atribua a trilha por cargo, equipe, departamento, perfil ou a todos. Informe prazo e obrigatoriedade.
2. Em *Permissões → Regras*, ajuste exceções (liberar ou bloquear por pessoa, equipe ou cargo). Use *Verificar acesso* para conferir quem enxerga o quê.
3. Os líderes de cada área também podem atribuir trilhas e prazos para a própria equipe.

## 7. Convidar as pessoas

1. Em *Usuários e convites*, convide cada pessoa com nome, e-mail, perfil, cargo e equipe:
   - com SMTP configurado, o convite vai por e-mail;
   - sem SMTP, copie o link e envie por um canal seguro.
2. Se a liberação após o primeiro acesso estiver ativa, libere cada pessoa na ficha dela ou pelo aviso no painel administrativo.
3. Indique os líderes e as áreas e equipes que acompanham, na ficha do usuário.

## 8. Acompanhar

- **Painel administrativo:** pendências, convites, liberações e alertas de configuração.
- **Relatórios:** engajamento, aprovação, questões com mais erros e competências validadas, com exportação em CSV.
- **Painel do líder:** progresso da equipe, prazos, validações e dúvidas.

## Lista de conferência da primeira trilha

- [ ] Termos de uso publicados
- [ ] Departamentos, equipes e cargos cadastrados
- [ ] Área criada
- [ ] Trilha criada com tipo e capa
- [ ] Módulos na ordem certa
- [ ] PDFs enviados e conferidos em "Ver como colaborador"
- [ ] Exercícios e avaliação final com nota mínima
- [ ] Conteúdos, módulos e trilha publicados
- [ ] Trilha atribuída ao público certo, com prazo
- [ ] Colaboradores convidados (e liberados, se for o caso)
