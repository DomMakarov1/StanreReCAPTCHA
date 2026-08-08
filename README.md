# wordbridge

Give it two words. It names the thing connecting them.

```
orange + president  →  Donald Trump
wood   + fire       →  ash
time   + saying     →  time is money
```

Runs entirely on a local [Ollama](https://ollama.com) model. No API key, no
account, no per-query cost, nothing leaves your machine.

## Requirements

- Node.js 18 or newer
- [Ollama](https://ollama.com/download) — or let `npm run setup` install it

No npm dependencies — everything uses Node built-ins.

## Quick start

```sh
npm run setup                     # installs Ollama if missing, starts the service
npm run build-models -- qwen3:8b  # builds one model (~5 GB download)
npm start                         # http://localhost:3000
```

`npm run setup` uses winget on Windows and Homebrew on macOS, falling back to
downloading the official installer directly. On Linux it runs Ollama's install
script. If it can't manage it, it says so and points you at the download page —
it won't leave you guessing.

Building **all** the default base models is a ~45 GB download, so start with one
and add others once you know the pipeline works:

```sh
npm run build-models              # the full default line-up
npm run build-models -- qwen3:8b gemma3:12b
```

### "`ollama` was not found" right after installing it

The installer adds Ollama to your PATH, but only for terminals opened
*afterwards*. This project looks in the standard install locations too, so it
should work regardless — but if you're running `ollama` by hand, open a new
terminal first.

## The bake-off

This is the important part. Which base model you pick matters far more than any
other decision here, and the only way to know is to measure.

```sh
npm run bakeoff
```

Every model gets the same 35 test pairs and the same Modelfile, so the only
variable is the base. Output looks like:

```
model                overall    causal    entity     idiom     title  compound   concept median ms
relate-qwen3-8b          63%       83%       38%       50%       60%      100%       75%       420
relate-gemma3-12b        71%       83%       50%       63%       80%      100%       75%       910
```

The category split is what to read. Expect a shape like the above: **causal and
compound pairs are easy** for any model, **entity and idiom pairs are where small
models fall apart.** That gap is the real quality signal — a model that scores
well on `entity` knows things, one that doesn't is guessing fluently.

**Treat the number as a signal, not a verdict.** Word association has many valid
answers and `bakeoff/testpairs.json` only lists the ones we thought of. Always
read the `MISSES` section: if a model answered `charcoal` for `wood + fire`,
that's a good answer and the test set is wrong, not the model. Add it to the
`accept` list and re-run.

Full per-pair results are written to `bakeoff/results-<timestamp>.json`.

### Which base models to try

Knowledge scales hard with parameter count on exactly the pairs you care about,
so take the largest thing that fits in memory.

| RAM | Try | Download | Expect |
|---|---|---|---|
| 8 GB | `llama3.2:3b`, `qwen3:4b` | ~2–3 GB | Fine on causal pairs, poor on people and idioms |
| 16 GB | `qwen3:8b`, `gemma3:12b` | ~5–8 GB | Workable middle ground |
| 32 GB | `mistral-small3.2`, `gemma3:27b` | ~15–17 GB | Noticeably better entity and idiom recall |
| 64 GB+ | `llama3.3:70b` | ~40 GB | Best local knowledge, slow without a big GPU |

**Slow generation matters less here than you'd expect.** The answer is one or
two tokens, so even a 27B model running on CPU returns in a couple of seconds.
What you'll notice is the *first* query after startup, while weights load into
memory — after that `keep_alive` holds the model there for 10 minutes.

A GPU makes everything faster but changes nothing about what fits: Ollama falls
back to system RAM, and for one-word answers that's perfectly usable.

## Tuning

Everything that shapes behaviour lives in **`models/Modelfile.template`** — the
system prompt, the sampling parameters, and the few-shot `MESSAGE` examples.

The few-shot block does the heavy lifting. For small models, examples move
behaviour far more than instructions do, and each one there teaches a different
kind of link (entity, causal, idiom, format-hint, compound). If you edit them,
keep that spread, and keep the list short — too many and the model starts
matching the examples instead of generalising past them.

After any edit, rebuild and re-measure:

```sh
npm run build-models && npm run bakeoff
```

Other knobs worth trying: raise `temperature` if answers feel too safe, and add
`PARAMETER num_ctx 2048` if you want to trade a little memory for headroom.

## If the bake-off disappoints

The fallback is fine-tuning: generate a few thousand `(word, word) → answer`
examples, LoRA-train the best base from your bake-off, export to GGUF, and point
a Modelfile at it with `FROM ./your-model.gguf`. It still runs in Ollama and the
rest of this project is unchanged.

Do that only after the bake-off, though — a better base model is a much cheaper
win than training, and you need the bake-off numbers to know whether training
actually helped.

## How it fits together

```
public/index.html   the page
server.js           serves it, and proxies /api/relate → Ollama
lib/answer.js       strips <think> tags, preambles, quotes; scores matches
lib/ollama.js       the one place that talks to Ollama over HTTP
lib/ollama-bin.js   locates the ollama executable; checks the service
scripts/setup.js    installs Ollama and starts it
models/             Modelfile template — the actual prompt
bakeoff/            test pairs, model builder, scoring harness
```

The server proxies rather than letting the browser call Ollama directly. That's
deliberate: a direct call is cross-origin, so it would need `OLLAMA_ORIGINS` set
on every machine that runs this. Proxying keeps it same-origin and setup-free.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port for the web UI |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Where Ollama is listening |
| `RELATE_MODEL` | *(first available)* | Default model, overridable in the UI |

## Known rough edges

- **Small models never say "I don't know."** The prompt tells them to always
  commit, which is right for a word game but means a confident wrong answer and
  a confident right one look identical. That's inherent, not a bug to fix.
- **First query after startup is slow** (weights loading). Subsequent ones are
  fast — the server sets `keep_alive: 10m` to hold the model in memory.
- Thinking models (`qwen3`, `deepseek-r1`) are asked not to think and stripped
  if they do anyway. If you add a reasoning model and see `<think>` in the UI,
  that's the path to check.
