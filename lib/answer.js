'use strict';

// Shared between the server and the bake-off so both judge output identically.

// Thinking models (qwen3, deepseek-r1, ...) emit reasoning inline even when
// asked not to. Strip it before anything else touches the string.
const THINK_TAGS = /<think>[\s\S]*?<\/think>/gi;
const ORPHAN_THINK = /<\/?think>/gi;
// The "is"/":" separator is required, not optional — otherwise a legitimate
// one-word answer that happens to be a listed noun (Link, Connection) would be
// stripped down to nothing.
const PREAMBLE = /^(?:the\s+)?(?:answer|connection|link|result|response)\s*(?:\bis\b\s*:?|:)\s*(?=\S)/i;

/** Reduce a model's raw reply to the bare answer. */
function cleanAnswer(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(THINK_TAGS, '').replace(ORPHAN_THINK, '');

  const firstLine = s
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];
  if (!firstLine) return '';

  return firstLine
    .replace(PREAMBLE, '')
    .replace(/^[\s"'`*_[(]+/, '')
    .replace(/[\s"'`*_\])]+$/, '')
    .replace(/[.!]+$/, '')
    .trim();
}

/** Fold away casing, punctuation and articles so near-misses still count. */
function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True if `response` counts as one of `accepts`.
 *
 * Containment runs both ways on purpose: "Donald Trump" should satisfy an
 * expected "Trump", and a model that answers "Trump" should satisfy an expected
 * "Donald Trump". The 3-character floor and word-boundary check keep short
 * answers from matching inside unrelated words.
 */
function isMatch(response, accepts) {
  const r = normalize(response);
  if (!r) return false;

  return (accepts || []).some((accept) => {
    const n = normalize(accept);
    if (!n) return false;
    if (r === n) return true;

    const [short, long] = r.length <= n.length ? [r, n] : [n, r];
    if (short.length < 3) return false;
    return new RegExp(`(^|\\s)${escapeRegExp(short)}($|\\s)`).test(long);
  });
}

/**
 * Split a reverse-mode reply ("orange, president") into its two halves.
 * Returns null when the model didn't produce two comma-separated items.
 */
function parsePair(raw) {
  const parts = cleanAnswer(raw)
    .split(',')
    // Strip list numbering ("1. orange") as well as the usual quoting, since
    // small models reach for it whenever they're asked for more than one thing.
    .map((part) => part.replace(/^\s*\d+[.)]\s*/, '').replace(/^[\s"'`*]+|[\s"'`*.]+$/g, ''))
    .filter(Boolean);

  return parts.length >= 2 ? { a: parts[0], b: parts[1] } : null;
}

module.exports = { cleanAnswer, normalize, isMatch, parsePair };
