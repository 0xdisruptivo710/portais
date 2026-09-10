# Fixtures de e-mail dos portais

Os arquivos `.eml` deste diretório são **e-mails reais da caixa da cliente**,
gravados por `npm run varrer -- --fixtures`. Cada um carrega nome, telefone,
e-mail e a mensagem escrita por uma pessoa de verdade.

**Nenhum `.eml` pode ser commitado como veio da caixa.** Por isso
`api/_lib/parsers/fixtures/**/*.eml` está no `.gitignore` da raiz do app: o
padrão é que estes arquivos fiquem só na máquina de quem rodou a varredura.

Para transformar um e-mail real em fixture versionável:

1. Substitua nome, telefone, e-mail e qualquer texto livre escrito pelo lead
   por dados inventados. O que o parser precisa é da **estrutura** do HTML,
   não do conteúdo.
2. Confira também cabeçalhos (`To`, `Return-Path`, `Message-ID`) e links de
   anúncio com identificador de usuário.
3. Gere o `<nome>.esperado.json` a partir do arquivo já anonimizado — ele
   guarda os mesmos dados extraídos e vazaria a mesma coisa.
4. Só então force a entrada no versionamento: `git add -f <arquivo>.eml`.

Fixture anonimizado nunca é apagado quando um portal muda de layout: o teste
(`../fixtures.test.ts`) roda o parser novo contra todos, que é como se
descobre que o parser de hoje quebrou o e-mail de ontem.
