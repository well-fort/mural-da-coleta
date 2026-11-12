# Mural da Coleta · versão 2

Mural brasileiro de pesquisas acadêmicas abertas a respostas. Quem só quer
ajudar responde sem criar conta; quem está coletando dados cria um cadastro,
publica a ficha da pesquisa e recebe respostas.

O site não hospeda questionário nem guarda resposta. Cada pesquisa continua no
formulário de quem a criou (Google Forms, Qualtrics, LimeSurvey, o que for), e o
que entra aqui é a ficha e o link. Esta pasta é o site completo: basta enviá-la
ao GitHub.

A estrutura é a mesma do Caça-IA e do Descubra a Verdade: um site em HTML puro,
publicado no GitHub Pages, com login e banco online no plano gratuito do
Firebase, e modo demonstração enquanto o Firebase não estiver configurado.

---

## O que mudou da versão 1 para a 2

| Mudança | Como ficou |
|---|---|
| Créditos | Desligados. Cadastro e depósito são livres, sem saldo e sem cobrança por resposta recebida. A mecânica continua inteira no código, atrás de uma chave. |
| Ordem do mural | Quem está mais longe da meta de respostas aparece primeiro. Pesquisas com menos de 7 dias recebem a etiqueta *nova no mural*. |
| Administração | O e-mail fundador é administrador permanente, sem precisar do console. Pela tela, ele promove e remove outros administradores. |
| Imagem | Cada pesquisa pode ter uma imagem, comprimida no próprio navegador. |
| Avaliação | Ao registrar participação, a pessoa avalia a clareza das perguntas e diz se o tempo bateu com o declarado. |
| WhatsApp | Botão que monta a mensagem pronta com título, tempo e link da ficha. |
| Meta | A ficha mostra uma barra com quanto falta para fechar a amostra. |
| Tráfego | O site conta visitas, fichas abertas e cliques no questionário, por dia e por pesquisa. A administração tem uma aba de tráfego, e cada autor vê os números das pesquisas dele. |
| Instalar o código | Depois de publicar, uma tela mostra o código, a mensagem pronta para a tela de confirmação e onde colá-la no Google Forms. |
| Trocar código | Botão no painel, já que o código não pode ser consultado depois. |
| Diagnóstico | O painel lê os números da pesquisa e diz, em uma frase, o que está travando a coleta. |
| Rascunho | A ficha pode ser guardada fora do mural enquanto o questionário está sendo montado. |
| Reciprocidade | A ficha mostra quantas pesquisas de colegas o autor já respondeu. |
| Denúncia | Qualquer pessoa, com conta ou sem, pode avisar que há algo errado com uma pesquisa. |
| Moderação | Aba com as mensagens recebidas e os sinais que o site levanta sozinho a partir dos números. |
| Retirar do mural | Degrau entre deixar e apagar: reversível, com motivo que o autor lê. |
| Registro | Tudo que a administração faz fica gravado e não pode ser editado pelo site. |
| LGPD | Exportar e apagar os dados de uma pessoa, pela aba de pesquisadores. |
| Busca | Filtro por texto nas tabelas de pesquisas e de cadastros. |
| Ficha para o respondente | Tempo, anonimato e botão acima da dobra no celular; os detalhes vêm depois. |
| Identificação | O autor declara se o questionário identifica quem responde, e isso aparece em destaque. |
| Acessibilidade | Contraste corrigido e alvos de toque de 44 px. |

---

## As regras que o site aplica

| Assunto | Como funciona |
|---|---|
| Responder | Sem cadastro. Qualquer pessoa abre o mural, escolhe uma pesquisa e responde no formulário do pesquisador. |
| Depositar | Com cadastro, que é livre: qualquer e-mail serve, a pessoa declara nível, programa, instituição e, se quiser, o Lattes. Não há aprovação manual nem espera. |
| Ordem do mural | Pela proporção que falta para a meta declarada. Sem meta, o site assume 100 respostas. Empate, a mais recente primeiro. |
| Código de conclusão | O autor escolhe um código e o coloca na mensagem de confirmação do formulário dele. Quem respondeu informa o código aqui, e a participação entra na contagem pública. O código nunca aparece no mural: o banco guarda só a impressão digital (SHA-256) e compara. |
| Uma vez por pessoa | O identificador da participação é `pesquisaId__uid`, então ninguém registra duas vezes a mesma pesquisa. |
| Avaliação | Clareza de 1 a 5 e se o tempo bateu. Com três ou mais avaliações e a maioria dizendo que levou mais, o mural avisa. |
| Ética | Para depositar, a pessoa declara que o formulário apresenta o TCLE antes das perguntas. O número do CAAE é opcional; quem informa ganha o carimbo *aprovada em CEP*. |

---

## Acesso de administrador

O e-mail **wellington1989fortunato@gmail.com** está escrito em `app.js`
(constante `ADMIN_FUNDADOR`) e em `firestore.rules` (função `emailFundador`).
Quem entrar com esse e-mail é administrador, mesmo com o banco vazio. Não é
preciso criar nada no console do Firebase.

Para incluir outra pessoa: ela cria um cadastro normal no site; depois, na
administração, aba *pesquisadores*, use **tornar administrador**. A aba
*administradores* mostra quem tem acesso e permite remover.

Para trocar o e-mail fundador, altere os dois arquivos e publique as regras de
novo. As duas pontas precisam dizer a mesma coisa: o site decide o que mostrar,
e a regra do Firestore decide o que pode gravar.

---

## A economia de créditos, desligada

Em `app.js`, logo no começo:

```js
var CREDITOS_LIGADOS = false;
```

Com `false` (o estado atual) o cadastro não recebe saldo, o depósito não separa
créditos, responder não rende nada e o mural não tem a seção de quem ficou sem
saldo. Com `true`, tudo isso volta: saldo de boas-vindas de 15 créditos, um
crédito a cada cinco minutos de questionário e desconto a cada resposta
recebida.

**As regras do Firestore já aceitam os dois modos**, então religar a economia
não exige publicar regra nova. Se mudar a conta dos créditos, porém, altere a
função `valorEmCreditos` em `app.js` **e** a função `valor` em
`firestore.rules`: o navegador calcula e a regra do banco confere.

Vale registrar por que foi desligada. Numa plataforma de troca, o primeiro
usuário chega e não encontra nada para responder; cobrar reciprocidade antes de
existir o que trocar só aumenta o atrito de quem chega. Com a comunidade
pequena, o que sustenta a troca é a ordem do mural favorecer quem precisa.
Quando houver movimento, a economia volta com um interruptor.

---

## As imagens

O Cloud Storage do Firebase exige o plano pago, então as imagens não usam
serviço de arquivos: são comprimidas no navegador de quem publica e guardadas
no próprio banco, em dois tamanhos.

- **Miniatura**, até cerca de 45 KB e 320 px de largura, dentro do documento da
  pesquisa. É o que o mural carrega.
- **Capa**, até cerca de 500 KB e 1000 px, em documento separado na coleção
  `imagens`. Só é buscada quando alguém abre a ficha.

A divisão existe para o mural não baixar imagem grande de dez pesquisas de uma
vez. O limite de um documento do Firestore é 1 MB, e a regra recusa imagem
acima de 700 KB.

---

## O código de conclusão, e por que ele não pode ser consultado

Para que ninguém descubra o código espiando o site, o banco guarda apenas uma
impressão digital dele (SHA-256 do identificador da pesquisa somado ao código).
A consequência é que nem o Mural consegue recuperá-lo: se o pesquisador
esquecer, o caminho é trocar por outro, não consultar.

Por isso o fluxo tem uma tela própria depois de publicar, em `#/publicada/id`,
com o código em destaque, o aviso de que ele não volta, a mensagem pronta para
copiar e o passo a passo do Google Forms. Essa tela é o ponto mais frágil do
projeto: se o pesquisador não instalar o código no formulário, ninguém consegue
registrar participação e a pesquisa parece parada mesmo coletando bem.

O código em texto existe apenas na memória da aba, entre o momento em que a
pessoa o escolhe e essa tela. Recarregar a página o perde, e a tela avisa isso
em vez de fingir que está tudo certo.

---

## Rascunho

Uma pesquisa pode ser guardada como rascunho: fica no painel do autor, fora do
mural, fora da fila de respostas e fora das contagens. Serve para quem está
montando o questionário e ainda não tem o link definitivo.

Uma ressalva honesta: o mural é de leitura pública, e as regras do Firestore
não escondem um rascunho de quem souber o identificador dele. O rascunho não é
segredo, é apenas uma ficha que o site não lista. Não coloque nele nada que não
possa ser visto.

---

## A ficha, pensada para quem responde

Quase todo respondente chega por um link de WhatsApp, no celular, e cai
direto na ficha de uma pesquisa — não no mural. Por isso a ficha é a página
de entrada mais importante do site, e está organizada na ordem em que essa
pessoa decide:

1. Título e quem está pesquisando.
2. O resumo, em uma frase ou duas.
3. **O bloco de ação**: quanto tempo leva, se o questionário identifica quem
   responde, que não precisa de cadastro, o botão, e quanto falta para fechar
   a amostra.
4. Só então a imagem, os detalhes, o compartilhamento e o canal de denúncia.

Antes dessa mudança o botão ficava a 1.370 px do topo numa tela de 844: era
preciso rolar uma tela e meia para encontrar a única coisa que o visitante
veio fazer. Agora ele aparece a 655 px, dentro da primeira tela.

**A pergunta sobre identificação** existe porque é a primeira coisa que
qualquer pessoa quer saber antes de responder, e "TCLE declarado" não
responde isso para quem não é da academia. O autor escolhe entre três
situações honestas, e o mural mostra a resposta em letras claras.

A linguagem da parte pública evita jargão: o menu diz *Responder* e *Sou
pesquisador* em vez de *Depositar pesquisa*, e a ficha fala em "o
questionário explica a pesquisa e pede sua autorização" em vez de "TCLE".

Os números de acessibilidade também foram corrigidos: o cinza de apoio subiu
de contraste 3,7 para 5,0 (o mínimo é 4,5) e os botões passaram de 36 px de
altura para 44, que é o alvo de toque recomendado.

---

## Moderação

A administração tem três respostas possíveis para uma pesquisa problemática,
em ordem de dureza:

1. **Anotar.** Uma nota interna que só a administração vê, para o próximo
   administrador saber o que já foi observado.
2. **Retirar do mural.** A pesquisa sai das listas e para de receber
   participações, mas continua existindo. Exige um motivo escrito, que o autor
   lê na ficha e no painel dele, e pode ser desfeita a qualquer momento.
3. **Apagar.** Definitivo, e por isso pede que se digite a palavra APAGAR.

O autor não consegue devolver ao mural uma pesquisa que a administração
retirou, nem apagar o motivo: a regra do Firestore bloqueia isso.

### A fila de trabalho

A aba de moderação junta duas fontes. As **mensagens recebidas** vêm do canal
de denúncia, aberto no pé de cada ficha a qualquer pessoa, com ou sem conta —
quem encontra um problema costuma ser quem responde, e quem responde não tem
cadastro aqui. Cada aba envia no máximo uma mensagem por pesquisa.

Os **sinais** o site levanta sozinho, a partir dos números que já tem:

| Sinal | O que costuma significar |
|---|---|
| Cliques sem nenhum código informado em 14 dias | o código não foi colado na tela de confirmação do formulário |
| Ficha aberta muitas vezes e nenhum clique | o link está quebrado |
| Clareza abaixo de 3 com ao menos 3 avaliações | o questionário está confuso |
| Meta acima de 5.000 respostas | fora do comum para coleta acadêmica |
| Área de saúde sem CAAE | vale conferir se houve apreciação do CEP |

### O registro

Toda ação da administração grava uma linha com data, quem fez, o quê e sobre
quê. O registro não pode ser editado nem apagado pelo site, nem pela própria
administração — é essa impossibilidade que lhe dá valor. Protege quem é
administrado e, principalmente, quem administra: você administra o mural e
também deposita pesquisas nele, e esse é exatamente o tipo de acúmulo de
papéis que o registro existe para tornar verificável.

---

## LGPD na prática

Na aba de pesquisadores, cada linha tem dois botões que atendem a lei:

- **Dados da pessoa** baixa um CSV com a ficha, as pesquisas depositadas e as
  participações registradas. É o que se entrega a quem pede cópia dos próprios
  dados. Vale para qualquer cadastro, inclusive o fundador.
- **Apagar cadastro** remove a ficha, as pesquisas, as imagens, a reputação e
  as participações.

Uma limitação para a qual não há jeito pelo site: **apagar o cadastro não
apaga o login**. Remover uma conta do Firebase Authentication exige o SDK de
administração, que precisa de servidor. Depois de apagar os dados, remova
também a conta em *Authentication* → *Users*, no console — senão a pessoa
continua conseguindo entrar e o site vai pedir que ela se cadastre de novo.

---

## Os contadores de acesso

O site conta três coisas, todas anônimas e agregadas:

| Evento | Quando soma | Onde fica |
|---|---|---|
| Visita | Alguém abre o site numa aba | `metricas/dia-AAAA-MM-DD` |
| Ficha aberta | Alguém abre a ficha de uma pesquisa | o dia e `visualizacoes` na pesquisa |
| Clique | Alguém clica em abrir o questionário | o dia e `cliques` na pesquisa |

Cada aba soma uma visita uma vez, e cada ficha ou clique uma vez por aba, pelo
`sessionStorage` do navegador: recarregar a página não infla o número. O autor
abrindo a própria ficha não conta. As pesquisas de exemplo não contam.

**Não há cookie, não há IP e ninguém é identificado** — o que é melhor que
instalar o Google Analytics, porque dispensa banner de consentimento e não
cria base de dados pessoais sob a LGPD. O preço disso é não saber de onde vem
o acesso nem quem voltou.

**O que os números não medem.** O site vê o clique que leva ao questionário,
mas não vê o que acontece dentro dele: quem desistiu na terceira pergunta conta
como clique, e quem respondeu sem informar o código não conta como resposta. O
número verdadeiro de respostas está sempre no formulário do pesquisador.

**Contagem é de tendência, não de auditoria.** Qualquer visitante pode somar,
porque medir visita de quem não tem conta é justamente o objetivo. A regra do
Firestore limita cada escrita a somar um em um campo conhecido, mas alguém com
um script conseguiria inflar os números. Não use estes números em artigo.

A cota gratuita do Firestore é de 20 mil escritas por dia. Cada visita custa
uma escrita, e cada ficha aberta ou clique custa duas, o que comporta uns
sete mil eventos diários com folga.

---

## Estrutura da pasta

```
index.html            a casca da página
estilo.css            a identidade visual
app.js                toda a lógica do site
dados/exemplos.js     áreas, públicos e as 10 pesquisas de exemplo
firebase-config.js    chaves do projeto Firebase
firestore.rules       regras de segurança (colar no console do Firebase)
LEIA-ME.md            este arquivo
```

Sem configurar o Firebase, o site funciona por completo em **modo
demonstração**: tudo fica salvo apenas no navegador de quem abriu, e as dez
pesquisas são fictícias. Nesse modo a administração também respeita o e-mail
fundador, para a demonstração não enganar.

---

## Publicar no GitHub

O site está em `https://well-fort.github.io/mural-da-coleta/`, a partir do
repositório `well-fort/mural-da-coleta`.

Para atualizar: abra o repositório, clique em **Add file** e depois em **Upload
files**, e arraste o conteúdo desta pasta mantendo a subpasta `dados`. Arquivos
com o mesmo nome são substituídos. Em seguida, **Commit changes**; o GitHub
Pages republica sozinho em um ou dois minutos.

O site precisa abrir por `https`: a impressão digital do código de conclusão usa
um recurso do navegador que não funciona em `http`.

---

## O projeto no Firebase

Projeto `mural-da-coleta`, plano Spark (gratuito), com login por e-mail e senha
e Firestore em `southamerica-east1` (São Paulo), no modo de produção.

Ao mudar `firestore.rules` nesta pasta, publique no console: *Firestore
Database* → *Regras*, cole o conteúdo e clique em **Publicar**. O site não
publica regra sozinho.

### Coleções

| Coleção | O que guarda | Quem lê |
|---|---|---|
| `pesquisas` | A ficha, a miniatura e os contadores | Todo mundo, sem login |
| `imagens` | A capa grande, uma por pesquisa | Todo mundo, sem login |
| `pesquisadores` | Nome, e-mail, vínculo, Lattes | A própria pessoa e a administração |
| `participacoes` | Quem registrou código em qual pesquisa, com a avaliação | Quem respondeu, o autor da pesquisa e a administração |
| `admins` | Administradores além do fundador | Quem está logado |
| `metricas` | Visitas, fichas abertas e cliques, somados por dia | Só a administração |
| `reputacao` | Quantas pesquisas de colegas cada pessoa respondeu | Todo mundo |
| `denuncias` | Mensagens sobre pesquisas problemáticas | Só a administração |
| `registro` | O que a administração fez, sem poder editar depois | Só a administração |
| `config` | Ajustes gerais | Todo mundo |

---

## Limites conhecidos

- **O código de conclusão pode ser repassado.** Nada impede que alguém mande o
  código a um conhecido que não respondeu. As defesas que funcionam ficam no seu
  formulário: perguntas de controle de atenção, descarte de respostas enviadas
  em tempo muito menor que o declarado e leitura das respostas abertas.
- **O vínculo é declarado, não conferido.** Foi uma escolha, para não excluir
  quem não recebeu e-mail institucional. A administração vê o Lattes informado e
  pode bloquear um cadastro.
- **A avaliação é de quem registrou código.** Visitantes sem cadastro respondem
  mas não avaliam, então a nota vem só da parte acadêmica do público.
- **Imagem no banco tem teto.** Funciona bem para centenas de pesquisas. Se o
  site crescer muito, vale migrar as capas para um serviço de arquivos.
- **O nome.** Uma busca rápida não encontrou plataforma brasileira com o nome
  Mural da Coleta, mas vale conferir o registro no INPI e a disponibilidade do
  domínio antes de divulgar.
- **LGPD.** Como nenhuma resposta de questionário passa pelo site, a superfície
  de risco é pequena: os dados pessoais tratados aqui são os de quem deposita
  pesquisa. Ainda assim, antes de divulgar em escala vale escrever uma política
  de privacidade e os termos de uso, e indicar quem é o controlador dos dados.

---

## Próximos passos possíveis

1. Política de privacidade e termos de uso, com o controlador identificado.
2. Endereço próprio por pesquisa, em vez do endereço com `#`, para o link ficar
   apresentável quando compartilhado.
3. Aviso por e-mail quando a pesquisa se aproxima da meta ou fica parada.
4. Filtro por *responde bem no celular*, declarado pelo autor.
5. Página de uma instituição, reunindo as pesquisas de cada programa.
6. Religar a economia de créditos quando houver movimento suficiente.
7. Lembrete, alguns dias depois de publicar, para quem não recebeu nenhuma
   participação: é o sinal mais provável de que o código não foi instalado.
8. Avisar o autor por e-mail quando a pesquisa dele é retirada do mural. Hoje
   ele só descobre ao abrir o painel.
9. Ajustes configuráveis pela administração, hoje presos no código: exigir
   CAAE em áreas de saúde, limitar pesquisas simultâneas por pessoa, escrever
   um aviso no topo do mural.
