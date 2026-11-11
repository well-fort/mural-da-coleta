# Mural da Coleta · versão 1

Mural brasileiro de pesquisas acadêmicas abertas a respostas. Quem deposita o
próprio instrumento de coleta entra numa troca de créditos e responde ao de
outras pessoas; quem só quer ajudar responde sem criar conta.

O site não hospeda questionário nem guarda resposta. Cada pesquisa continua no
formulário de quem a criou (Google Forms, Qualtrics, LimeSurvey, o que for), e o
que entra aqui é a ficha e o link. Esta pasta é o site completo: basta enviá-la
ao GitHub.

A estrutura é a mesma do Caça-IA e do Descubra a Verdade: um site em HTML puro,
publicado no GitHub Pages, com login e banco online no plano gratuito do
Firebase, e modo demonstração enquanto o Firebase não estiver configurado.

---

## As regras que o site aplica

| Assunto | Como funciona |
|---|---|
| Responder | Sem cadastro. Qualquer pessoa abre o mural, escolhe uma pesquisa e responde no formulário do pesquisador. |
| Depositar | Só com cadastro. Qualquer e-mail serve; a pessoa declara nível, programa, instituição e, se quiser, o Lattes. Não há aprovação manual nem espera. |
| Créditos | Um crédito a cada cinco minutos de questionário, arredondados para cima, com teto de cinco. Uma pesquisa de dez minutos rende dois créditos a quem responde e consome dois a cada resposta recebida. |
| Boas-vindas | Cada cadastro novo recebe 15 créditos e pode publicar na hora, antes de responder qualquer coisa. |
| Sem saldo | A pesquisa não sai do ar: desce para a seção *sem créditos no momento*, no fim do mural, e volta ao topo quando o autor responder a outras pesquisas. |
| Código de conclusão | O autor escolhe um código e o coloca na mensagem de confirmação do formulário dele. Quem respondeu informa o código no site para receber os créditos. O código nunca aparece no mural: o banco guarda só a impressão digital (SHA-256) e compara. |
| Uma vez por pessoa | O identificador da participação é `pesquisaId__uid`, então ninguém registra duas vezes a mesma pesquisa. |
| Ética | Para depositar, a pessoa declara que o formulário apresenta o TCLE antes das perguntas. O número do CAAE é opcional; quem informa ganha o carimbo *aprovada em CEP* no mural. |

Para mudar a conta dos créditos, altere a função `valorEmCreditos` em `app.js`
**e** a função `valor` em `firestore.rules`. As duas precisam dizer a mesma
coisa: o navegador calcula, e a regra do banco confere.

---

## Estrutura da pasta

```
index.html            a casca da página
estilo.css            a identidade visual
app.js                toda a lógica do site
dados/exemplos.js     áreas, públicos e as 10 pesquisas de exemplo
firebase-config.js    chaves do projeto Firebase (preencher)
firestore.rules       regras de segurança (colar no console do Firebase)
LEIA-ME.md            este arquivo
```

Sem configurar o Firebase, o site já funciona por completo em **modo
demonstração**: dá para cadastrar, depositar, responder e abrir a administração,
mas tudo fica salvo apenas no navegador de quem abriu, e as dez pesquisas são
fictícias.

---

## Publicar no GitHub

1. Crie um repositório (sugestão: `mural-da-coleta`) e envie **todo o conteúdo
   desta pasta**, mantendo a subpasta `dados/`.
2. O arquivo principal precisa se chamar `index.html` e ficar na raiz.
3. Em *Settings* → *Pages*, escolha a branch `main` e a pasta `/ (root)`.
4. O site precisa abrir por `https`. A impressão digital do código de conclusão
   usa um recurso do navegador que não funciona em `http`.

---

## Ativar o login e o banco online (Firebase, plano gratuito)

Use um projeto Firebase **separado** do Caça-IA e do Descubra a Verdade. Os
nomes dos menus mudam de vez em quando conforme o console é atualizado.

1. **Criar o projeto.** Em `console.firebase.google.com`, crie um projeto (o
   Google Analytics pode ficar desligado).
2. **Ativar o login.** Em *Authentication* → *Sign-in method*, ative
   **E-mail/senha**. Em *Users*, clique em *Add user*, crie a sua conta de
   administrador e copie o **UID**.
3. **Criar o banco.** Em *Firestore Database* → *Create database*, escolha o modo
   de produção e a região `southamerica-east1` (São Paulo).
4. **Colar as regras.** Na aba *Rules* do Firestore, apague o conteúdo, cole o
   arquivo `firestore.rules` e clique em *Publish*.
5. **Dar permissão de administrador.** Na aba *Data*, crie a coleção `admins`. O
   identificador do documento precisa ser o **UID** do passo 2. Adicione um campo
   qualquer, por exemplo `papel` = `admin`.
6. **Copiar as chaves.** Em *Project settings* → *Your apps*, registre um app Web
   (ícone `</>`). Copie os valores de `firebaseConfig` para `firebase-config.js`.
7. **Publicar.** Envie o `firebase-config.js` atualizado ao GitHub, abra o site e
   entre com o e-mail e a senha que você criou no passo 2.

**Atenção ao passo 5.** A conta de administrador criada no passo 2 também precisa
de uma ficha de pesquisador para usar o site por dentro. Entre no site, e se ele
pedir cadastro, crie um com o mesmo e-mail por outra conta ou peça para a
administração. O caminho mais simples: crie seu cadastro normalmente pelo site,
pegue o UID em *Authentication* → *Users* e crie o documento em `admins` com esse
UID.

### Publicar os exemplos no banco

Na primeira vez, o Firestore está vazio e o mural aparece sem nada. Entre como
administrador, abra *Administração* → *Créditos e exemplos* e clique em
**publicar os exemplos**. Quando houver pesquisas de verdade, clique em
**apagar todos os exemplos**.

---

## O que as regras do Firestore garantem

- O mural é de leitura pública, sem login.
- O código de conclusão não é legível por ninguém, nem pelo navegador de quem
  responde: só a impressão digital trafega.
- A quantidade de créditos de cada participação é conferida pela regra, a partir
  da duração declarada na pesquisa. O número não vem do navegador.
- Créditos só nascem de duas formas: o saldo de boas-vindas, limitado a vinte
  pela regra, e uma participação registrada e conferida. Os créditos que entram
  numa pesquisa saem da carteira de quem deposita, na mesma gravação.
- E-mail, vínculo e Lattes são lidos apenas pela própria pessoa e pela
  administração. Nome e instituição são públicos, porque quem responde tem o
  direito de saber quem está pedindo seus dados.
- Ninguém se promove a administrador pelo site: só criando o documento em
  `admins` pelo console.

---

## Limites conhecidos

Vale ter isso claro antes de divulgar.

- **O código de conclusão pode ser repassado.** Nada impede que alguém mande o
  código a um conhecido que não respondeu. As defesas que funcionam de verdade
  ficam no seu formulário: perguntas de controle de atenção, descarte de
  respostas enviadas em tempo muito menor que o declarado e leitura das respostas
  abertas. O site permite trocar o código quando houver desconfiança.
- **O vínculo é declarado, não conferido.** Foi uma escolha, para não excluir
  quem não recebeu e-mail institucional. A administração vê o Lattes informado e
  pode bloquear um cadastro.
- **O site não mede a qualidade das respostas.** Ele conta participações, não
  avalia o que foi respondido. Um sistema de reputação entre pares fica para uma
  próxima versão.
- **Créditos colocados numa pesquisa não voltam para a carteira.** Era possível
  permitir, mas abriria caminho para inflar créditos sem gravação conferida. Por
  isso o formulário de depósito sugere separar poucos créditos de cada vez e
  recarregar depois.
- **O nome.** Uma busca rápida não encontrou plataforma brasileira com o nome
  Mural da Coleta, mas vale conferir o registro no INPI e a disponibilidade do
  domínio antes de divulgar.
- **LGPD.** Como nenhuma resposta de questionário passa pelo site, a superfície
  de risco é pequena: os dados pessoais tratados aqui são os de quem deposita
  pesquisa. Ainda assim, antes de abrir ao público vale escrever uma política de
  privacidade e os termos de uso, e indicar quem é o controlador dos dados.

---

## Próximos passos possíveis

Em ordem do que mais ajudaria, pensando no que você descreveu:

1. Política de privacidade e termos de uso, com o controlador identificado.
2. Reputação entre pares: quem responde com cuidado ganha prioridade no mural.
3. Aviso por e-mail quando a pesquisa fica sem créditos.
4. Filtro por perfil do respondente mais fino, para pesquisas que precisam de um
   público específico.
5. Página pública de uma pesquisa com endereço próprio, para o pesquisador
   divulgar o link do mural no lugar do link cru do formulário.
