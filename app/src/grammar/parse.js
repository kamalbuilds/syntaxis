import {
  DETERMINERS, PRONOUNS, AUXILIARIES, CONJUNCTIONS, NEGATORS, NUMBERS,
  PREPOSITIONS, VERBS, STATIVE, NOUNS, ADJECTIVES, ADVERBS,
} from './lexicon.js';

// The stem before the suffix must itself be substantial, otherwise "table"
// reads as "t" + "able" and a piece of furniture becomes an adjective.
const ADJ_SUFFIX = /^(?=.{4,})(.*?)(ous|ful|ive|less|ish|able|ible|ary|ent|ant)$/;
const adjectival = (word) => {
  const m = ADJ_SUFFIX.exec(word);
  return Boolean(m) && m[1].length >= 4;
};
const VERB_SUFFIX = /(ing|ed)$/;

function lemma(word) {
  if (NOUNS.has(word) || ADJECTIVES.has(word) || VERBS.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) {
    const stem = `${word.slice(0, -3)}y`;
    if (NOUNS.has(stem)) return stem;
  }
  if (word.endsWith('es') && word.length > 3) {
    const stem = word.slice(0, -2);
    if (NOUNS.has(stem) || VERBS.has(stem)) return stem;
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) {
    const stem = word.slice(0, -1);
    if (NOUNS.has(stem) || VERBS.has(stem)) return stem;
  }
  return word;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[""'']/g, "'")
    .replace(/n't\b/g, " n't")
    .match(/[a-z']+|[0-9]+|[.,;:!?]/g) || [];
}

// Tags are assigned lexicon-first, then by morphology, then by position. The
// tagger reports `known: false` for anything it had to guess, which the HUD
// prints so the blind spot is visible rather than hidden.
export function tag(tokens) {
  const tagged = [];
  let mainVerbSeen = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i];
    const lem = lemma(word);
    const prev = tagged[tagged.length - 1];
    let pos;
    let known = true;

    if (/^[.,;:!?]$/.test(word)) pos = 'PUNCT';
    else if (/^[0-9]+$/.test(word)) pos = 'NUM';
    else if (word in NUMBERS) pos = 'NUM';
    else if (NEGATORS.has(word) && word !== 'no' && word !== 'without') pos = 'NEG';
    else if (word === 'without') pos = 'PREP';
    else if (word in PREPOSITIONS) pos = 'PREP';
    else if (CONJUNCTIONS.has(word)) pos = 'CONJ';
    else if (word in ADVERBS) pos = 'ADV';
    else if (AUXILIARIES.has(word)) pos = STATIVE.has(word) && !mainVerbSeen ? 'VERB' : 'AUX';
    else if (VERBS.has(lem) || STATIVE.has(lem)) pos = 'VERB';
    else if (ADJECTIVES.has(lem)) pos = 'ADJ';
    else if (DETERMINERS.has(word)) pos = 'DET';
    else if (PRONOUNS.has(word)) pos = 'PRON';
    else if (NOUNS.has(lem)) pos = 'NOUN';
    else {
      known = false;
      if (word.endsWith('ly') && word.length > 4) pos = 'ADV';
      else if (adjectival(word)) pos = 'ADJ';
      else if (prev && prev.pos === 'AUX' && VERB_SUFFIX.test(word)) pos = 'VERB';
      else if (!mainVerbSeen && VERB_SUFFIX.test(word) && prev && (prev.pos === 'NOUN' || prev.pos === 'PRON')) pos = 'VERB';
      else pos = 'NOUN';
    }

    // A determiner or adjective immediately before an unknown verb-shaped word
    // means it is being used as a noun: "the burning", "a running".
    if (pos === 'VERB' && prev && (prev.pos === 'DET' || prev.pos === 'ADJ')) pos = 'NOUN';
    if (pos === 'VERB') mainVerbSeen = true;

    tagged.push({ word, lemma: lem, pos, known, index: i });
  }

  // A noun immediately followed by another noun is a modifier, not a second
  // volume: "a stone table" is one table made of stone, not stone beside table.
  for (let i = 0; i < tagged.length - 1; i += 1) {
    if (tagged[i].pos === 'NOUN' && tagged[i + 1].pos === 'NOUN') tagged[i].pos = 'NMOD';
  }
  return tagged;
}

let nodeId = 0;
function entity(token) {
  return {
    id: `n${nodeId += 1}`,
    kind: 'entity',
    word: token ? token.word : 'place',
    lemma: token ? token.lemma : 'room',
    adjectives: [],
    count: 1,
    negated: false,
    relation: 'subject',
    known: token ? token.known : true,
    children: [],
  };
}

function action(token, verbClass) {
  return {
    id: `n${nodeId += 1}`,
    kind: 'action',
    word: token ? token.word : 'is',
    lemma: token ? token.lemma : 'be',
    verbClass,
    negated: false,
    relation: 'root',
    children: [],
  };
}

function classOf(token) {
  if (!token) return 'state';
  if (VERBS.has(token.lemma)) return VERBS.get(token.lemma);
  if (STATIVE.has(token.lemma) || STATIVE.has(token.word)) return 'state';
  return 'state';
}

/**
 * Builds a dependency tree from tagged tokens.
 *
 * The tree is deliberately shallow and typed for architecture: one action root,
 * entities hanging off it by grammatical relation, and prepositional phrases
 * hanging off whichever head they actually modify. Coordination produces
 * siblings rather than nesting, because "and" is a parallel wing in the
 * building, not a deeper room.
 */
export function buildTree(tagged) {
  nodeId = 0;
  const words = tagged.filter((t) => t.pos !== 'PUNCT');
  let root = null;
  let subject = null;
  const orphans = [];

  let pending = { adjectives: [], count: null, negated: false };
  let currentRelation = null;      // set by a preposition, consumed by next noun
  let attachTo = null;             // head the next PP entity attaches to
  let lastEntity = null;
  let coordinate = false;
  const scene = { adverbs: [], unknown: [] };

  const flushInto = (node) => {
    node.adjectives = pending.adjectives;
    if (pending.count !== null) node.count = pending.count;
    node.negated = pending.negated;
    pending = { adjectives: [], count: null, negated: false };
  };

  for (let i = 0; i < words.length; i += 1) {
    const t = words[i];
    if (!t.known && t.pos === 'NOUN') scene.unknown.push(t.word);

    switch (t.pos) {
      case 'DET':
        if (t.word === 'no') pending.negated = true;
        break;

      case 'NUM':
        pending.count = Math.max(1, Math.min(12, NUMBERS[t.word] ?? (parseInt(t.word, 10) || 1)));
        break;

      case 'ADJ':
      case 'NMOD':
        pending.adjectives.push(t.lemma);
        break;

      case 'ADV':
        scene.adverbs.push(t.word);
        break;

      case 'NEG':
        if (root) root.negated = true;
        else pending.negated = true;
        break;

      case 'PREP':
        currentRelation = t.word === 'without' ? 'absent' : PREPOSITIONS[t.word];
        // A prepositional phrase names where its object sits relative to a
        // figure. After a verb the figure is the subject, not the clause, so
        // the phrase must not fall back to the hall.
        attachTo = lastEntity || subject || root;
        break;

      case 'CONJ':
        coordinate = true;
        break;

      case 'AUX':
        break;

      case 'VERB': {
        if (!root) {
          root = action(t, classOf(t));
          if (subject) {
            subject.relation = 'subject';
            root.children.push(subject);
          }
        } else {
          // A second verb becomes a serial action: a further wing off the root.
          const extra = action(t, classOf(t));
          extra.relation = 'sequel';
          root.children.push(extra);
        }
        currentRelation = null;
        lastEntity = null;
        break;
      }

      case 'NOUN':
      case 'PRON': {
        const node = entity(t);
        flushInto(node);

        if (currentRelation) {
          node.relation = currentRelation;
          const head = attachTo || root || subject;
          if (head) head.children.push(node);
          else orphans.push(node);
          currentRelation = null;
        } else if (coordinate && lastEntity) {
          node.relation = 'parallel';
          const parent = findParent(root, lastEntity) || root;
          if (parent) parent.children.push(node);
          else orphans.push(node);
        } else if (!root) {
          if (!subject) subject = node;
          else { node.relation = 'parallel'; orphans.push(node); }
        } else {
          node.relation = root.children.some((c) => c.relation === 'object') ? 'oblique' : 'object';
          root.children.push(node);
        }

        coordinate = false;
        lastEntity = node;
        attachTo = node;
        break;
      }

      default:
        break;
    }
  }

  if (!root) {
    root = action(null, 'state');
    if (subject) root.children.push(subject);
  } else if (subject && !root.children.includes(subject)) {
    root.children.unshift(subject);
  }
  for (const o of orphans) if (!findParent(root, o)) root.children.push(o);

  return { root, scene };
}

function findParent(node, target) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c === target) return node;
    const deeper = findParent(c, target);
    if (deeper) return deeper;
  }
  return null;
}

/** Stable 32-bit hash of the sentence. Same sentence, same building, forever. */
export function seedOf(text) {
  let h = 0x811c9dc5;
  const s = text.trim().toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function parse(text) {
  const tokens = tokenize(text);
  const tagged = tag(tokens);
  const { root, scene } = buildTree(tagged);
  return { text, tagged, root, scene, seed: seedOf(text) };
}
