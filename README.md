# NFS-e PDF → XML Converter

Aplicação web estática que converte DANFSe / NFS-e em PDF para o formato XML oficial (`sped.fazenda.gov.br/nfse` v1.01).

## Como usar

1. Abra `index.html` no navegador (ou acesse a URL do deploy).
2. Arraste ou selecione o PDF da NFS-e.
3. Visualize os dados extraídos na tela.
4. Clique em **Baixar XML** para salvar o arquivo gerado.

## Estrutura

```
/
├── index.html   # Página principal
├── app.js       # Parser PDF + gerador XML
├── style.css    # Estilos
├── render.yaml  # Configuração Render (Static Site)
└── README.md
```

## Deploy no Render

1. Faça push do projeto em um repositório GitHub/GitLab.
2. No [Render](https://render.com), clique em **New → Static Site**.
3. Selecione o repositório.
4. Configure:
   - **Publish directory:** `.` (raiz)
   - **Build command:** *(deixar em branco)*
5. Clique em **Deploy**.

O `render.yaml` já está configurado corretamente — o Render detecta automaticamente.

## Tecnologias

- **PDF.js** (Mozilla) — leitura de PDF no browser, sem backend
- HTML + CSS + JS puro — zero dependências de build
- Schema NFSe v1.01 — `http://www.sped.fazenda.gov.br/nfse`

## Notas

- PDFs de NFS-e brasileiros variam muito por município e emissor; o parser usa múltiplos padrões de regex para ser robusto.
- Campos não encontrados aparecem em vermelho no preview e são omitidos do XML gerado.
- Valores monetários são convertidos para ponto decimal (padrão XML).
