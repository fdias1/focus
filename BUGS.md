# Análise de bugs — Focus (server + desktop)

Auditoria estática feita contra os requisitos no `CLAUDE.md` e o código atual.
Os bugs já corrigidos nesta sessão (race do `QRWindow`, consumo atômico do token,
limpeza do dedup de `notifications`, unique constraint em `webPushSubscriptions`)
**não** estão listados aqui. Cada item tem severidade, descrição, impacto, e plano
de ação. Severidade segue `crítico / alto / médio / baixo`.

---

## Desktop app

### D1 — `ScreenScanner` faz pareamento incorreto de displays em multi-monitor
**Severidade:** alto
**Local:** [`desktop/src/main/modules/ScreenScanner.ts:77-80`](desktop/src/main/modules/ScreenScanner.ts:77)

```ts
const source =
  sources.find((s) => s.display_id === String(display.id)) ??
  sources[displays.indexOf(display)] // fallback: positional match
```

Quando `display_id` vem vazio (Linux, e algumas versões/Wayland), o fallback usa
o índice posicional. A ordem retornada por `desktopCapturer.getSources()` **não é
garantida** igual à ordem de `screen.getAllDisplays()`. Pareamento errado faz o
`ChangeDetector` comparar frame do display A contra prevFrame do display B —
falso positivo permanente.

**Plano:** Comparar `bounds.width × scaleFactor` e `bounds.height × scaleFactor`
do display contra `thumbnail.getSize()` da source como segundo critério; se ainda
ambíguo, descartar o frame e logar. Considerar reportar `permissionDenied` ou um
novo evento `captureMismatch` para a UI alertar.

---

### D2 — `InactivityDetector` bloqueia a thread principal com `execSync` a cada 500ms
**Severidade:** alto (Windows) / médio (macOS)
**Local:** [`desktop/src/main/modules/InactivityDetector.ts:9-47, 61`](desktop/src/main/modules/InactivityDetector.ts:9)

O detector chama `execSync` 2×/segundo. No Windows isso spawna PowerShell + JIT
de C# em todo poll — dezenas a centenas de ms de bloqueio do event loop por
chamada. No macOS é mais leve (`ioreg`) mas ainda bloqueia.

**Impacto:** janela de config trava ao mover slider; alarme atrasa; bateria.

**Plano:**
1. Trocar para `execFile` assíncrono ou um worker thread.
2. No Windows, manter o tipo `Add-Type` carregado em uma sessão PowerShell
   persistente (spawn uma vez, comunicar via stdin) — ou usar `node-ffi-napi`
   para chamar `GetLastInputInfo` direto.
3. No macOS, alternativa nativa: `CGEventSourceSecondsSinceLastEventType`.
4. Reduzir a frequência de poll para 1s — 500ms é exagero para detectar
   inatividade que tem threshold mínimo de 5s.

---

### D3 — `ScreenScanner` falha silenciosa: todo erro vira "permissionDenied"
**Severidade:** médio
**Local:** [`desktop/src/main/modules/ScreenScanner.ts:95-98`](desktop/src/main/modules/ScreenScanner.ts:95)

```ts
} catch (e) {
  this.emit('permissionDenied')
}
```

OOM, falha de IPC, bug em driver de captura — tudo é reportado como permissão
negada. UI mostra banner enganoso e usuário é mandado para System Settings sem
necessidade.

**Plano:** Logar `e` antes do emit. Adicionar evento separado `captureError` com
mensagem; só emitir `permissionDenied` quando `getMediaAccessStatus('screen') !== 'granted'`.

---

### D4 — `StateManager.onFrame` não valida se `prev` e `curr` têm a mesma dimensão
**Severidade:** médio
**Local:** [`desktop/src/main/modules/StateManager.ts:100-122`](desktop/src/main/modules/StateManager.ts:100)
+ [`desktop/src/main/modules/ChangeDetector.ts:71-107`](desktop/src/main/modules/ChangeDetector.ts:71)

Se a resolução do display mudar entre dois frames (rotação, mudança de DPI,
reconexão de monitor mantendo o mesmo `display.id`), `prev.data.length` ≠
`curr.data.length`. `hasSignificantChange` itera assumindo iguais — lê
out-of-bounds, produz comparação inválida.

**Plano:** Em `onFrame`, comparar `prev.width === frame.width && prev.height === frame.height`;
se diferir, descartar `prev`, armazenar `frame` e retornar. Adicionar teste com
buffers de dimensões distintas.

---

### D5 — Dedup do servidor é código morto (`bountyBoxId` é UUID novo a cada notify)
**Severidade:** baixo
**Local:** [`desktop/src/main/modules/StateManager.ts:131`](desktop/src/main/modules/StateManager.ts:131)
+ [`server/app/api/notify/route.ts:23-29`](server/app/api/notify/route.ts:23)

```ts
this.remote.notify(crypto.randomUUID())
```

Como o desktop gera um UUID fresco a cada chamada, a tabela `notifications` no
servidor (UNIQUE em `(id, desktopId)`) nunca detecta duplicata — o dedup é
inalcançável. A tabela só servia para "esquecer" retries do mesmo evento.

**Plano:**
- **Opção A:** Gerar o ID estável por evento de alarme (uma vez quando a
  transição vai para `'alarm'`, reutilizar nos retries) — só faz sentido se
  `RemoteNotifier` ganhar lógica de retry.
- **Opção B:** Remover o dedup do servidor (e a tabela `notifications`
  inteira) — sem retries, é peso morto.

---

### D6 — `OverlayManager.redraw` envia array gigante via `executeJavaScript`
**Severidade:** médio (perf)
**Local:** [`desktop/src/main/modules/OverlayManager.ts:146-152`](desktop/src/main/modules/OverlayManager.ts:146)

Em display 4K com chunk de 10px → 384×216 = 82.944 booleans. `JSON.stringify`
+ parse JS via `executeJavaScript` a cada frame durante o alarme é caro.

**Plano:** Trocar `executeJavaScript` por `webContents.send` IPC com a
`Uint8Array` direto (estrutura é cloneable). Re-renderizar apenas quando o
buffer `entry.active` mudou (atual sempre redesenha).

---

### D7 — `desktop/register` da rota servidor + `DesktopRegistrar` permitem recuperação de `apiKey` sem prova
**Severidade:** médio (modelo de segurança)
**Local:** [`server/app/api/desktop/register/route.ts:23`](server/app/api/desktop/register/route.ts:23)

```ts
if (existing) return json({ desktopId: existing.id, apiKey: existing.apiKey })
```

Comentário promete "apiKey só na criação"; código devolve sempre. Quem souber
um `desktopId` (UUID 128-bit, difícil de adivinhar) pega o `apiKey`. Reduz a
segurança do `apiKey` a "obscuridade do UUID".

**Plano:** Retornar o `apiKey` apenas no INSERT (201). No GET subsequente
(existing), retornar 200 apenas com `desktopId` (sem key). O desktop só sabe se
está autenticado tentando uma rota autenticada e tratando 401 → re-register
com novo UUID gerado localmente.

---

### D8 — `ConfigStore` não valida shape de `watchAreas` ao ler/gravar
**Severidade:** baixo
**Local:** [`desktop/src/main/modules/ConfigStore.ts:62, 79-81`](desktop/src/main/modules/ConfigStore.ts:62)

Arquivo manualmente editado, ou `watchAreas` órfãs após um monitor ser
desconectado, podem injetar coordenadas inválidas que chegam até o
`ChangeDetector`. O `relevantChunks === 0` guard ajuda mas não é completo.

**Plano:** Validar com zod no `get()` e `set()`. Descartar entradas cujo
`displayId` não existe atualmente em `screen.getAllDisplays()` (com fallback
para "manter mas avisar"). Clampar `x/y/width/height` ao bounds físico do
display.

---

### D9 — Áudio do alarme sem captura de erro
**Severidade:** baixo
**Local:** [`desktop/src/main/modules/AlarmManager.ts:9-15`](desktop/src/main/modules/AlarmManager.ts:9)

`exec('afplay …')` e o PowerShell são fire-and-forget. Som ausente ou
permissão negada → alarme silencioso, sem diagnóstico.

**Plano:** Captura `error` e `exit` do child process; logar quando
`exitCode !== 0`. Considerar fallback usando o `shell.beep()` do Electron.

---

### D10 — `AreaSelector`: ESC só funciona no display focado
**Severidade:** baixo (UX)
**Local:** [`desktop/src/main/modules/AreaSelector.ts:81-83, 142-153`](desktop/src/main/modules/AreaSelector.ts:81)

Com múltiplos displays, o usuário precisa clicar primeiro em um display para
poder cancelar com ESC. Não é óbvio.

**Plano:** Registrar atalho global via `globalShortcut.register('Escape', …)`
durante a seleção e liberar em `done()`. Ou usar `before-input-event` em todas
as janelas.

---

### D11 — `QRWindow.waitForPairing` faz polling de 3s sem timeout em fetch individual
**Severidade:** baixo
**Local:** [`desktop/src/main/modules/QRWindow.ts:38-53`](desktop/src/main/modules/QRWindow.ts:38)

Se o servidor pendurar, cada poll pode demorar arbitrariamente, atrasando a
detecção do cancel via `controller.signal`. O signal é passado mas o fetch não
o consome.

**Plano:** Passar `signal: controller.signal` ao `fetch`. Considerar
backoff: 1s → 2s → 3s ao invés de fixo.

---

### D12 — `StateManager.applyConfig` reinicia o scanner em mudança de `snapshotInterval`, perdendo o ciclo
**Severidade:** baixo
**Local:** [`desktop/src/main/modules/StateManager.ts:65-69`](desktop/src/main/modules/StateManager.ts:65)
+ [`desktop/src/main/modules/ScreenScanner.ts:38-42`](desktop/src/main/modules/ScreenScanner.ts:38)

`scanner.start()` chama `capture()` imediato e cria novo timer. Se o usuário
mover o slider, há captura imediata; o "prevFrame" recente vira "currFrame" do
próximo ciclo — janela de detecção encolhe, falso negativo possível.

**Plano:** Em `start()`, agendar primeira captura para `interval` segundos no
futuro quando já existe um `prev`. Ou em `applyConfig`, só ajustar o
`setInterval` sem disparar captura imediata.

---

## Server app

### S1 — `pairing/create` não trata colisão de token (token de 6 chars retornado mesmo em conflito)
**Severidade:** baixo (probabilidade ínfima, mas logicamente errado)
**Local:** [`server/app/api/pairing/create/route.ts:32-37`](server/app/api/pairing/create/route.ts:32)

```ts
await db.insert(pairingTokens).values(...).onConflictDoNothing()
return json({ token, expiresAt: ... }, 201)
```

Espaço de tokens ≈ 32⁶ ≈ 10⁹. Probabilidade real ≈ 0 com baixo tráfego, mas em
conflito o desktop recebe um `token` que está vinculado a outro `desktopId`. O
usuário escaneia e pareia o desktop errado.

**Plano:** Usar `.returning()`; se 0 linhas, regerar token (loop com ≤3
tentativas, falhar se persistir). Trivial de implementar.

---

### S2 — `pairing/confirm` não é atômico — token consumido mesmo se INSERT subsequente falhar
**Severidade:** baixo
**Local:** [`server/app/api/pairing/confirm/route.ts`](server/app/api/pairing/confirm/route.ts)

O driver Neon (HTTP) executa cada statement como request separado. Não há
transação envolvendo o `DELETE token RETURNING` + `INSERT clientDevices` +
`INSERT pairings`. Se um INSERT subsequente falhar (erro de DB raro), o token
foi consumido e o usuário precisa pedir novo QR.

**Plano:**
- Idealmente envolver em transação. Neon HTTP suporta transações via
  `db.transaction(async (tx) => …)` (verificar versão do drizzle-orm).
- Alternativa: gerar a pairing **antes** do delete; só deletar o token após
  o INSERT bem-sucedido. Mas isso reabre a race condition de double-consume.
  A transação é a abordagem correta.

---

### S3 — `pairings/client/[clientId]` sem autenticação
**Severidade:** baixo (privacidade)
**Local:** [`server/app/api/pairings/client/[clientId]/route.ts`](server/app/api/pairings/client/[clientId]/route.ts)

Qualquer um com um `clientId` vê os desktops pareados daquele cliente. UUID
é difícil de adivinhar, mas se vazar (URL compartilhada, log), expõe dados.

**Plano:** Adicionar challenge. Opções:
- Header `x-client-id` que deve bater com o param (não dá segurança extra,
  mas torna scraping mais difícil).
- Cookie httpOnly emitido em `client/register` com um secret derivado do
  clientId (rotacionável).
- Aceitar como está e documentar como limitação conhecida.

---

### S4 — `notify` envia push em loop serial em vez de paralelo
**Severidade:** médio (latência)
**Local:** [`server/app/api/notify/route.ts:56-67`](server/app/api/notify/route.ts:56)

Itera com `await` por subscription. Com 5 dispositivos pareados e 200ms de RTT,
1s só para enviar. Em serverless, isso ainda conta no tempo de execução.

**Plano:** Trocar o loop por uma única chamada `sendWebPush(allSubs, payload)`
(a função já aceita array e faz `Promise.allSettled` internamente). Depois,
deletar todos os IDs expirados em um único `inArray`.

---

### S5 — `client/register` e `desktop/register` sem rate limit
**Severidade:** baixo
**Local:** [`server/app/api/client/register/route.ts`](server/app/api/client/register/route.ts), [`server/app/api/desktop/register/route.ts`](server/app/api/desktop/register/route.ts)

Endpoints livres → atacante enche o banco. Sem custo significativo enquanto o
projeto for pequeno, mas vetor real.

**Plano:** Middleware Next.js + `@upstash/ratelimit` (free tier no Vercel) ou
LRU em memória com janela de 60s e teto de N requests por IP.

---

### S6 — Tabela `notifications` sem primary key explícita
**Severidade:** baixo (smell)
**Local:** [`server/db/schema.ts:54-64`](server/db/schema.ts:54)

```ts
export const notifications = pgTable('notifications', {
  id: uuid('id').notNull(),
  desktopId: uuid('desktop_id').notNull(),...
}, (t) => [unique().on(t.id, t.desktopId)])
```

Tem unique composto mas nenhuma PK. PostgreSQL permite, mas ferramentas
(drizzle-studio, replicação) podem ter problemas.

**Plano:** Promover o `unique` para `primaryKey().on(t.id, t.desktopId)` em
drizzle. Já que essa tabela pode sumir junto com D5 (dedup morto), avaliar
remoção total primeiro.

---

### S7 — PWA: lista de notificações em `localStorage` cresce sem limite
**Severidade:** baixo
**Local:** [`server/app/mobile/page.tsx:117-122, 43-45`](server/app/mobile/page.tsx:117)

Notificações são acumuladas sem cap. Quota do localStorage (~5MB) é alta mas
finita, e a renderização degrada com centenas de itens.

**Plano:** Cap em 50 ou 100; `next.slice(0, 100)` antes de `saveNotifications`.

---

### S8 — PWA: `confirmPairing` sem try/catch em network failure
**Severidade:** baixo
**Local:** [`server/app/mobile/page.tsx:327-350`](server/app/mobile/page.tsx:327)

Se o fetch lançar (offline), a tela fica em "Pairing…" indefinidamente.

**Plano:** Envolver em `try/catch`; no catch, `setStatus('Network error, try again')` e voltar para home.

---

### S9 — PWA: `subscribe` POST retorna 404 se chamado antes de `client/register` completar
**Severidade:** baixo (race no init)
**Local:** [`server/app/api/web-push/subscribe/route.ts:30-35`](server/app/api/web-push/subscribe/route.ts:30)
+ [`server/app/mobile/page.tsx:153-165`](server/app/mobile/page.tsx:153)

Na inicialização da PWA, `client/register` e o re-sync da subscription rodam
em paralelo. Se a subscription ganhar a corrida, 404.

**Plano:**
- **No servidor:** trocar o `select+if(!client) return 404` por
  `db.insert(clientDevices).values({ id: clientId }).onConflictDoNothing()`
  antes do upsert do subscription — self-healing.
- **No cliente:** encadear o `.then(() => syncSubscription())` na promise de
  register.

---

### S10 — `notify` route: `webPushSent` conta tentativas, não sucessos
**Severidade:** muito baixo (telemetria)
**Local:** [`server/app/api/notify/route.ts:66`](server/app/api/notify/route.ts:66)

Incrementa antes/sem verificar resultado. Métrica enganosa.

**Plano:** Calcular pelo tamanho de `webSubs - expired`. Após batchar (S4),
fica trivial.

---

### S11 — `pairing/[pairingId]` DELETE usa body em request DELETE
**Severidade:** baixo (compat)
**Local:** [`server/app/api/pairing/[pairingId]/route.ts:13-21`](server/app/api/pairing/[pairingId]/route.ts:13)

DELETE com body é aceito pelo HTTP, mas alguns proxies/clientes podem
descartar o body. Funciona hoje porque tudo é via `fetch`, mas é frágil.

**Plano:** Aceitar `clientId` via query string ou header (`x-client-id`). E
proteger o `req.json()` com try/catch (atual lança 500 em body vazio).

---

### S12 — Service worker faz fallback de `bountyBoxId` para `crypto.randomUUID`
**Severidade:** muito baixo
**Local:** [`server/public/sw.js:49`](server/public/sw.js:49)

```ts
id: (data.data && data.data.bountyBoxId) || crypto.randomUUID(),
```

Mascara um bug do servidor (sempre envia bountyBoxId). Defensivo demais — se
algum dia o servidor parar de enviar, o erro fica invisível.

**Plano:** Remover o fallback ou trocar por descartar a notification. Não
prioritário.

---

### S13 — Service worker `clear` apaga TUDO se `desktopId` vier vazio
**Severidade:** muito baixo
**Local:** [`server/public/sw.js:14, 21`](server/public/sw.js:14) + [`server/app/mobile/page.tsx:124-128`](server/app/mobile/page.tsx:124)

```ts
const desktopId = (data.data && data.data.desktopId) || ''
…
const next = msg.desktopId ? prev.filter(...) : []
```

Servidor sempre envia `desktopId`, mas se algum dia falhar, o cliente apaga
notificações de **todos** os desktops.

**Plano:** No service worker, descartar a mensagem clear se `desktopId` estiver
vazio (em vez de propagar string vazia).

---

## Inconsistências de modelo / requisitos

### M1 — CLAUDE.md prescreve `changeSensitivity` 0–100 (%) mas código usa fração 0.01–1
**Severidade:** baixo (doc errada)
**Local:** [`CLAUDE.md:43-49`](CLAUDE.md:43) vs [`desktop/src/main/modules/ConfigStore.ts:11, 14`](desktop/src/main/modules/ConfigStore.ts:11)

```
// CLAUDE.md:
changeSensitivity: number  // default: 10  (percentage 0–100)

// ConfigStore:
changeSensitivity: 0.1
BOUNDS: changeSensitivity: [0.01, 1]
```

Mas em `ChangeDetector.hasSignificantChange`, a comparação é
`(changedChunks / relevantChunks) * 100 >= sensitivityPct` — espera 0-100. O
valor real passado da config (0.01 a 1) é tratado como 0.01% a 1%.

Tem inconsistência tripla: doc diz default 10%, código grava 0.1, e o consumidor
ainda multiplica por 100 esperando 0-100. Efetivamente o sensibilidade
mínima/atual é 0,1% (ou seja: bem mais sensível que o documentado), o que
ajuda a explicar falsos positivos.

**Plano:**
1. Decidir a representação canônica: fração (0–1) ou percentual (0–100).
2. Ajustar `BOUNDS`, default, slider no `App.tsx` (label diz `%` mas range é
   0.01–1), e a comparação em `ChangeDetector`. Documentar no CLAUDE.md.

---

### M2 — CLAUDE.md prescreve "ChangeDetector é pure function" mas atual retorna `ChunkGrid` que carrega estado de UI
**Severidade:** muito baixo (estilo)
**Local:** [`desktop/src/main/modules/ChangeDetector.ts:8-12`](desktop/src/main/modules/ChangeDetector.ts:8)

Função é pura, ok. O retorno inclui `grid: ChunkGrid | null` que serve a
OverlayManager — vazamento de uma preocupação de UI para o detector. Funciona,
mas afasta o módulo do contrato no CLAUDE.md.

**Plano:** Manter, ou separar em duas funções: `detect()` retornando bool +
`computeGrid()` retornando o grid. Baixo valor.

---

### M3 — `localNotifications` e `remoteNotifications` não constam no schema documentado em CLAUDE.md
**Severidade:** muito baixo (doc desatualizada)
**Local:** [`CLAUDE.md:43-49`](CLAUDE.md:43) vs [`desktop/src/shared/ipc-types.ts:18-26`](desktop/src/shared/ipc-types.ts:18)

CLAUDE.md lista só 4 campos no schema. Código tem 7 (3 a mais: `watchAreas`,
`localNotifications`, `remoteNotifications`).

**Plano:** Atualizar `CLAUDE.md`.

---

## Sugestão de priorização

Ordem recomendada se você quiser fazer um sprint de robustez:

1. **D2** (`InactivityDetector` blocking) — impacto perceptível no Windows.
2. **D1** (pareamento de displays multi-monitor) — falso positivo permanente.
3. **D4** (mismatch de dimensão entre frames) — crash possível.
4. **M1** (`changeSensitivity` inconsistente) — qualidade de detecção.
5. **S4** (push em paralelo) — latência sob carga.
6. **S2** (`pairing/confirm` não atômico) — robustez raro mas real.
7. **D7** (`apiKey` recuperável) — modelo de segurança.
8. **D6** (overlay JSON gigante) — perf em alta resolução.
9. **D3** (erros mascarados como permission denied) — UX/debug.
10. Resto (baixo / muito baixo): tratar caso a caso.

Sem custo de migração de DB: D1, D2, D3, D4, D6, D9, D10, D11, D12, M1, M2, M3,
S4, S8, S9, S10, S12, S13.

Com custo de migração de DB (`db:push`): S6 (drop `notifications` se for por
D5) e nada mais.
