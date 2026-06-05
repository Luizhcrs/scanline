<p align="center"><img src="assets/logo.png" width="120" alt="Scanline"></p>
<h1 align="center">Scanline</h1>
<p align="center">Multiplexador de terminal nativo do Windows + navegador scriptavel para agentes de IA.</p>

<p align="center"><b>Portugues</b> &middot; <a href="README.en.md">English</a></p>

---

Scanline ocupa uma unica janela. Dentro dela voce divide paineis de terminal e paineis de navegador WebView2 nativos lado a lado, troca de contexto com workspaces em abas verticais, e da ao agente um navegador scriptavel via CDP — ele tira snapshot, clica, preenche e captura tela de um app web rodando ao lado do shell que o construiu.

Nativo do Windows: WebView2 + ConPTY. Sem WSL, sem tmux, sem Chromium embutido.

## O que e e por que existe

**O loop de agente para o qual o Scanline foi feito:** o agente edita codigo num painel, roda o dev server em outro, depois tira snapshot e dirige o proprio app web num painel WebView2 ao lado via CDP — com os passos arriscados barrados por cartoes de aprovacao (Feed) que travam ate um humano revisar.

Capacidades principais:

- **Grid de tiling** — divide pra direita ou pra baixo, redimensiona, zoom, equaliza e navega entre paineis pelo teclado.
- **Workspaces em abas verticais** — cada workspace mostra cwd, branch git + marca de sujo, portas escutando e status de PR via `gh`.
- **Abas de surface** — varios terminais empilhados numa mesma folha do grid, com reordenar arrastando.
- **Paineis de navegador** — webviews filhas WebView2 reais. Ignoram X-Frame-Options, entao qualquer site carrega. Voltar/avancar/recarregar, zoom de pagina e DevTools inclusos.
- **API de navegador scriptavel** — CDP via `scanline browser`: snapshot dos elementos interativos como `e1`, `e2`, …; click, fill, eval, screenshot e mais. O agente referencia elementos por tag, nao por XPath fragil.
- **Servidor de controle por named pipe** — processos externos dirigem o grid ao vivo escrevendo requisicoes JSON-line V2 em `\\.\pipe\scanline` e lendo as respostas. A CLI em Go embrulha isso pro uso no shell.
- **Integracao com agentes** — `scanline <agente>` sobe qualquer agente num ambiente fake-tmux, entao os `tmux split-window` dele viram paineis Scanline de verdade. Hooks de ciclo de vida do Claude Code acendem os pontos de status do painel e postam notificacoes.
- **Cartoes de aprovacao (Feed)** — `scanline ask` trava ate um humano clicar numa opcao; o hook do agente pode barrar na resposta antes de seguir.
- **Restauracao de sessao** — workspaces, arvore de layout, cwd e URLs do navegador sao persistidos e restaurados ao abrir.
- **UI bilingue** — interface em portugues ou ingles, detectada do idioma do SO no primeiro boot, com override manual nas Configuracoes.
- **Instancia unica** — uma segunda abertura foca a janela existente em vez de subir um processo paralelo.

**Como se compara:**

| Ferramenta | Diferenca |
|---|---|
| cmux (manaflow-ai) | so macOS, GPL-3.0 |
| wmux | alternativa Windows mais proxima — tambem tem navegador CDP; Scanline difere em licenca MIT, local-first e UI PT-BR/EN nativa |
| Warp | IA atrelada a nuvem e centrada no shell; sem painel de navegador dirigido por agente |
| Wave Terminal | o widget de navegador e somente-leitura pra IA, nao um alvo scriptavel via CDP |
| Windows Terminal / WezTerm / Tabby | sem hooks de agente, sem navegador scriptavel, sem sidebar de status de PR |

Posicionamento do Scanline: a UX agent-native do cmux trazida pro Windows — navegador WebView2 scriptavel via CDP, local-first, MIT, leve (reaproveita o runtime WebView2 do proprio SO, sem Chromium embutido) e UI nativa PT-BR/EN.

## Instalacao

### Baixar o instalador

Na pagina de Releases do GitHub voce escolhe entre **instalador** e **portable**:

**https://github.com/Luizhcrs/scanline/releases/latest**

- `Scanline_<versao>_x64-setup.exe` — instalador NSIS (recomendado). Cria atalhos no Menu Iniciar e baixa o runtime WebView2 automaticamente se faltar.
- `Scanline_<versao>_x64_en-US.msi` — instalador MSI, pra deploy gerenciado (Group Policy, Intune).
- `Scanline_<versao>_portable_x64.zip` — portable. Descompacte e rode `app.exe`, sem instalar. Mantenha o `scanline.exe` na mesma pasta.

Como o Scanline ainda nao e assinado digitalmente, o Windows SmartScreen vai mostrar o dialogo "O Windows protegeu o computador" ao rodar o instalador. Isso e esperado em apps open-source sem assinatura. Clique em "Mais informacoes" e depois "Executar mesmo assim" — o instalador e seguro e o codigo-fonte esta inteiro neste repositorio.

O auto-update in-app ainda nao esta habilitado (a chave de assinatura do updater nao foi configurada). Por enquanto, baixe versoes novas pela pagina de Releases.

### Compilar do codigo-fonte

Pre-requisitos: Node 20+, Rust stable + MSVC build tools, Go 1.25+.

```powershell
cd app
npm install
npm run tauri build
```

Saida: `app\src-tauri\target\release\bundle\` (instaladores NSIS + MSI e o `.exe` puro).

Compile a CLI separadamente:

```powershell
cd cli
go build
```

Isso gera `scanline.exe` (o modulo Go tambem se chama `scanline`). Coloque no PATH pra que agentes e scripts alcancem a janela em execucao.

<details>
<summary><b>Recursos</b></summary>

- Grid de tiling: divide direita/baixo, redimensiona, zoom, equaliza, navega foco por seta.
- Workspaces: sidebar em abas verticais com cwd, branch git + marca de sujo, portas escutando, PR vinculado via `gh`.
- Abas de surface: varios terminais por folha do grid, reordenar arrastando, pular pra aba.
- Paineis de navegador: webviews filhas WebView2 nativas (ignoram X-Frame-Options), voltar/avancar/recarregar, zoom de pagina, DevTools.
- Navegador scriptavel via CDP: `snapshot`, `click`, `fill`, `type`, `eval`, `text`, `html`, `exists`, `wait`, `count`, `find`, `attr`, `value`, `visible`, `checked`, `check`, `uncheck`, `select`, `press`, `scroll`, `zoom`, `viewport`, `cookies`, `storage`, `screenshot`, `navigate`, `back`, `forward`, `reload`, `devtools`.
- Servidor de controle por named pipe: requisicao/resposta JSON-line V2, pra CLI e agentes comandarem e consultarem o grid ao vivo.
- Integracao com agentes: launcher fake-tmux, hooks de ciclo de vida do Claude Code, cartoes de aprovacao (Feed).
- Notificacoes: bells por painel, badge de nao-lidas por workspace, painel de notificacoes.
- Restauracao de sessao: layout, cwd, URLs do navegador — persistidos em `%APPDATA%\scanline\session.json`.
- UI bilingue: portugues / ingles, auto-detectado do SO no primeiro boot, override em `ui.language` (`auto` / `pt` / `en`); a troca aplica via relaunch limpo.
- Instancia unica: segunda abertura foca a janela existente em vez de subir um processo paralelo.
- Config: `scanline.json` em JSONC, reload ao vivo no foco da janela ou `scanline config reload`.
- Toques nativos: barra de titulo escura combinando com o chrome do app, log de crash em `%APPDATA%\scanline\crash.log`.

</details>

<details>
<summary><b>Atalhos de teclado</b></summary>

### Geral

| Atalho | Acao |
|---|---|
| Ctrl+Shift+P | Paleta de comandos |
| Ctrl+P | Trocar workspace / painel |
| Ctrl+/ | Ajuda de atalhos |
| Ctrl+, | Configuracoes |
| Ctrl+Shift+M | Modo minimal |
| F11 | Tela cheia |
| Ctrl+B | Alternar sidebar |
| Ctrl+F | Buscar |
| Ctrl+Shift+F | Buscar no diretorio |

### Workspaces

| Atalho | Acao |
|---|---|
| Ctrl+N | Novo workspace |
| Alt+1..8 | Pular pra workspace (Alt+9 = ultimo) |
| Alt+Shift+, / . | Workspace anterior / proximo |

### Paineis e divisoes

| Atalho | Acao |
|---|---|
| Alt+Shift+Right | Dividir pra direita |
| Alt+Shift+Down | Dividir pra baixo |
| Alt+Shift+B | Abrir painel de navegador |
| Alt+Setas | Mover foco entre paineis |
| Alt+Shift+Z | Zoom no painel |
| Alt+Shift+E | Equalizar divisoes |
| Ctrl+Shift+H | Piscar painel focado |
| Ctrl+Shift+W | Fechar painel |

### Abas (surfaces)

| Atalho | Acao |
|---|---|
| Ctrl+T | Nova aba de terminal |
| Ctrl+W | Fechar aba |
| Ctrl+Tab / Ctrl+Shift+Tab | Proxima / anterior aba |
| Ctrl+1..9 | Pular pra aba |

### Terminal

| Atalho | Acao |
|---|---|
| Ctrl+Shift+K | Limpar scrollback |
| Ctrl+= / Ctrl+- / Ctrl+0 | Tamanho da fonte (painel navegador: zoom de pagina) |
| Ctrl+Shift+C / V | Copiar / colar |
| Ctrl+Shift+A | Selecionar tudo |

### Notificacoes

| Atalho | Acao |
|---|---|
| Alt+Shift+N | Painel de notificacoes |
| Alt+Shift+U | Pular pra ultima nao-lida |

Todas as acoes remapaveis podem ser sobrescritas em `scanline.json` na chave `keybindings`.

</details>

<details>
<summary><b>Referencia da CLI</b></summary>

O Scanline precisa estar rodando. A CLI fala com ele por `\\.\pipe\scanline`.

Um processo rodando dentro de um painel herda `SCANLINE_SURFACE_ID`, entao comandos como `send`, `status` e `browser` miram o proprio painel do chamador por padrao — sem precisar da flag `--surface`.

### Layout e paineis

```powershell
scanline split [--dir row|col] [-- <command...>]   # divide o painel focado
scanline run -- <command...>                       # divide e roda um comando
scanline web <url>                                 # abre um painel de navegador
scanline focus <left|right|up|down>                # move o foco
scanline list                                      # lista paineis (id, tipo, focado, rect)
scanline close                                     # fecha o painel focado
scanline equalize                                  # equaliza tamanhos das divisoes
scanline zoom                                      # alterna zoom no painel focado
scanline resize [delta]                            # redimensiona painel focado (delta padrao: 0.05)
scanline fullscreen                                # alterna tela cheia
```

### I/O de painel

```powershell
scanline read   [--surface N]                      # le texto do scrollback de um painel
scanline send   [--surface N] <text...>            # envia texto literal a um painel
scanline key    [--surface N] <key>                # envia tecla/chord (enter, c-c, up, ...)
scanline status [--surface N] <running|waiting|idle|error>  # define o ponto de status
```

### Abas de surface

```powershell
scanline surface new
scanline surface next | prev
scanline surface close
scanline surface select <n>          # indice base-1
scanline surface rename <name>
```

### Workspaces

```powershell
scanline ws list
scanline ws new
scanline ws select <id>
scanline ws close <id>
scanline ws rename <id> <name>
scanline ws current
```

### Notificacoes

```powershell
scanline notify [--title T] <body...>   # posta notificacao num painel
scanline notif                          # lista notificacoes
scanline notif clear                    # limpa todas as notificacoes
```

### Agente e hooks

```powershell
scanline <agente> [args...]             # sobe um agente em ambiente fake-tmux
scanline claude-teams [args...]         # sobe o Claude em modo teammate
scanline hooks setup                    # instala hooks do Claude Code global (~/.claude/settings.json)
scanline hooks setup --project          # instala em ./.claude/settings.json
```

### Diversos

```powershell
scanline ask [--title T] [--options a,b,c] <question...>   # cartao de aprovacao bloqueante; imprime a escolha
scanline config edit                    # abre scanline.json no editor padrao
scanline config reload                  # recarrega config ao vivo
scanline ping                           # health check
```

</details>

<details>
<summary><b>API de navegador scriptavel</b></summary>

```powershell
# Navegacao
scanline browser open <url>
scanline browser navigate <url> | back | forward | reload
scanline browser devtools

# Inspecao
scanline browser snapshot               # marca elementos interativos como e1, e2, ...
scanline browser url
scanline browser text [css]
scanline browser html [css]
scanline browser exists <css>
scanline browser wait <css>
scanline browser count <css>
scanline browser find <text...>
scanline browser attr <ref> <name>
scanline browser value <ref>
scanline browser visible <ref>
scanline browser checked <ref>

# Interacao
scanline browser click <ref|css>
scanline browser fill <ref|css> <text...>
scanline browser type <ref|css> <text...>
scanline browser check <ref> | uncheck <ref>
scanline browser select <ref> <value>
scanline browser press <key>
scanline browser scroll [ref]

# Estado da pagina
scanline browser eval <js>
scanline browser zoom <factor>
scanline browser viewport <width> <height>
scanline browser cookies [clear]
scanline browser storage [get [key] | set <key> <value> | clear]

# Saida
scanline browser screenshot [--out file.png]

# Todos os verbos browser aceitam --surface N pra mirar um painel de navegador especifico.
```

Exemplo de loop de agente:

```powershell
scanline run -- npm run dev
scanline web http://localhost:5173
scanline browser snapshot
scanline browser click e7
scanline browser fill e3 "hello@example.com"
scanline browser screenshot --out after.png
```

</details>

<details>
<summary><b>Integracao com agentes</b></summary>

### Launcher fake-tmux

`scanline <agente>` sobe qualquer binario de agente num ambiente fake-tmux: um shim `tmux.cmd` e escrito em `%USERPROFILE%\.scanline\shim\` e adicionado ao inicio do PATH, e `TMUX` / `TMUX_PANE` sao setados pra que o agente acredite estar numa sessao tmux. Quando o agente roda `tmux split-window`, o shim encaminha pra `scanline __tmux-compat`, que traduz isso num split de painel real.

Verbos tmux traduzidos: `split-window`, `select-pane`, `kill-pane`, `resize-pane`, `send-keys`, `list-panes`, `capture-pane`, `has-session`.

```powershell
scanline claude             # Claude Code com tmux-compat
scanline claude-teams       # Claude em modo teammate (SCANLINE_CLAUDE_TEAMS=1)
scanline codex              # ou qualquer outro agente no PATH
```

### Hooks do Claude Code

O Scanline instala estes hooks automaticamente na inicializacao (idempotente — so
adiciona as proprias entradas e nunca quebra uma config nao-parseavel), pra que os
pontos de status do painel e as notificacoes funcionem de cara. Pra (re)instalar
na mao, ex. numa config local do projeto:

```powershell
scanline hooks setup            # escreve em %USERPROFILE%\.claude\settings.json
scanline hooks setup --project  # escreve em .\.claude\settings.json
```

O hook e no-op fora de um painel Scanline, entao nunca atrapalha sessoes do Claude
rodando num terminal normal.

Mapeamento de eventos:

| Evento do Claude Code | Status do painel |
|---|---|
| UserPromptSubmit | running |
| PreToolUse / PostToolUse | running |
| Notification | waiting + notificacao postada |
| Stop / SubagentStop | idle |

</details>

<details>
<summary><b>Configuracao</b></summary>

A config fica em `%APPDATA%\scanline\scanline.json`. O formato e JSONC (comentarios `//` e `/* */` permitidos). O arquivo e carregado no boot e recarregado ao vivo no foco da janela ou com `scanline config reload`. Abra com `scanline config edit` ou Ctrl+, no painel de Configuracoes.

```jsonc
{
  "terminal": {
    "fontFamily": "Consolas, 'Cascadia Mono', monospace",
    "fontSize": 14,
    "scrollback": 10000,
    "theme": {
      "background": "#000000",
      "foreground": "#ffffff",
      "cursor": "#5aa0ff"
    }
  },
  "ui": {
    "fontFamily": "\"Segoe UI Variable Text\", \"Segoe UI\", system-ui, sans-serif",
    "minimal": false,
    // "auto" segue o idioma do SO; "pt" ou "en" forcam.
    "language": "auto"
  },
  // Remapeia acoes. Formato: "ctrl+alt+shift+key".
  // Acoes: palette, switcher, find, findInDir, newWorkspace, newTab,
  //          settings, minimal, fullscreen, help.
  "keybindings": {}
}
```

Outros arquivos de estado (nao editados pelo usuario):

| Arquivo | Conteudo |
|---|---|
| `%APPDATA%\scanline\session.json` | Layout de workspace, cwd, URLs do navegador |
| `%APPDATA%\scanline\crash.log` | Relatorios de crash |

</details>

<details>
<summary><b>Arquitetura</b></summary>

```mermaid
flowchart TB
    subgraph WIN["Janela Scanline (WebView2)"]
        direction LR
        SIDE["Sidebar<br/>workspaces"]
        GRID["Grid<br/>paineis xterm.js (DOM)<br/>+ webviews filhas WebView2"]
        SIDE --- GRID
    end

    subgraph RUST["Nucleo Rust (Tauri 2)"]
        PTY["Ponte ConPTY<br/>portable-pty: spawn / read / write / size"]
        BROW["Gerenciador de navegador<br/>webviews filhas + ponte CDP"]
        PIPE["Servidor de controle por named pipe<br/>&#92;&#92;.&#92;pipe&#92;scanline (V2 JSON)"]
        PERSIST["Persistencia de sessao + config<br/>%APPDATA%&#92;scanline"]
    end

    subgraph CLI["CLI Go (scanline.exe)"]
        CMD["Comandos diretos<br/>split / run / web / browser / send"]
        SHIM["Shim tmux-compat<br/>tmux split-window &rarr; paineis reais"]
        AGENT["Launcher de agente<br/>+ hooks do Claude Code"]
    end

    WIN -->|"Tauri IPC<br/>comandos + eventos"| RUST
    RUST -.->|"CDP via with_webview<br/>CallDevToolsProtocolMethod"| WIN
    CLI <-->|"linhas JSON sobre named pipe"| PIPE
```

- **Frontend:** TypeScript + Vite + xterm.js. O terminal usa o renderer DOM de proposito — o addon WebGL trava o renderer do WebView2 nessa stack.
- **PTY:** cada painel de terminal e um ConPTY via `portable-pty`. A saida e agrupada e codificada em base64 antes de cruzar a ponte IPC do Tauri.
- **Paineis de navegador:** webviews filhas WebView2 nativas posicionadas sobre o grid DOM. A API scriptavel alcanca `ICoreWebView2` pela valvula de escape `with_webview` do Tauri e chama `CallDevToolsProtocolMethodAsync` pra CDP de verdade.
- **Controle:** um servidor de named pipe de instancia unica (`\\.\pipe\scanline`) encaminha requisicoes pro frontend e roteia as respostas de volta, permitindo tanto comandos fire-and-forget quanto consultas requisicao/resposta.

</details>

<details>
<summary><b>Estrutura do projeto</b></summary>

```
scanline/
  app/                   Aplicacao Tauri
    index.html           shell + splash escuro
    src/                 Frontend (TypeScript, xterm.js)
      main.ts            Shell do app: workspaces, atalhos, dispatch de controle
      layout.ts          Grid de tiling (splits, foco, zoom, serializacao)
      pane.ts            Painel de terminal (xterm + ponte ConPTY)
      paneContainer.ts   Abas de surface dentro de uma folha do grid
      browser.ts         Painel de navegador (webview filha WebView2)
      browserApi.ts      API de navegador scriptavel via CDP
      palette.ts         Paleta de comandos + barra de busca
      contextmenu.ts     Menu de contexto (clique direito)
      overlay.ts         Pilha de overlays (Esc / clique-fora)
      feed.ts            Cartoes de aprovacao bloqueantes
      notifications.ts   Store + painel de notificacoes
      settings.ts        Painel de configuracoes
      config.ts          scanline.json load / merge / apply
      updater.ts         Auto-update na inicializacao
      onboarding.ts      Modal de boas-vindas (4 slides, PT/EN)
      tooltip.ts         Tooltips customizados (substitui title nativo)
      types.ts           Tipos compartilhados do frontend
      styles.css         Tokens de design + estilos do chrome
      *.test.ts          Testes unitarios (Vitest)
    src-tauri/           Nucleo Rust
      src/lib.rs         Ponte PTY, ponte browser/CDP, servidor de controle, config
      tauri.conf.json    Config de janela + bundle (versao 1.0.0)
      Cargo.toml         Dependencias Rust
  cli/                   CLI Go + shim tmux-compat
    main.go              Dispatch de comandos + RPC por pipe
    tmux.go              Traducao tmux-compat + launcher de agente
    browser.go           Verbos de navegador scriptavel na CLI
    hooks.go             Dispatch + setup dos hooks do Claude Code
    feed.go              Aprovacao bloqueante (scanline ask)
    *_test.go            Testes da CLI
```

</details>

## Licenca

MIT. O Scanline e uma reimplementacao clean-room da UX agent-native de terminal pioneirada pelo cmux (manaflow-ai/cmux, GPL-3.0). Nenhum codigo e copiado do cmux; o comportamento do shim tmux-compat e da integracao com agentes e modelado, nao derivado. Veja [LICENSE](LICENSE).
