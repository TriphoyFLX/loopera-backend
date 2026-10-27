/** Musical tips for a loop based on key / BPM / genre — bass-first guidance. */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

const NOTE_ALIASES: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  H: 'B',
};

export type BassNoteTip = {
  note: string;
  role: string;
  beats: string;
  tip: string;
};

export type MusicalTips = {
  key: string | null;
  mode: 'major' | 'minor' | null;
  root: string | null;
  scale_notes: string[];
  bass_notes: BassNoteTip[];
  bass_pattern: string[];
  bass_howto: Array<{ title: string; body: string }>;
  chord_ideas: string[];
  placement: string[];
  bpm_tip: string | null;
};

function parseKey(raw?: string | null): { root: string; mode: 'major' | 'minor' } | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (!cleaned) return null;

  const match = cleaned.match(/^([A-Ga-g][#b]?)(m|min|minor|maj|major)?$/i);
  if (!match) return null;

  let root = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  if (root.length > 1 && root[1] === 'b') {
    root = NOTE_ALIASES[root] || root;
  }
  if (NOTE_ALIASES[root]) root = NOTE_ALIASES[root];
  if (!NOTE_NAMES.includes(root as (typeof NOTE_NAMES)[number])) return null;

  const modeRaw = (match[2] || '').toLowerCase();
  const mode: 'major' | 'minor' =
    modeRaw === 'm' || modeRaw === 'min' || modeRaw === 'minor' ? 'minor' : 'major';

  return { root, mode };
}

function noteAt(root: string, semitones: number): string {
  const idx = NOTE_NAMES.indexOf(root as (typeof NOTE_NAMES)[number]);
  return NOTE_NAMES[(idx + semitones + 120) % 12];
}

function detectStyle(genre?: string | null, tags?: string[] | null): string {
  const blob = `${genre || ''} ${(tags || []).join(' ')}`.toLowerCase();
  if (/drill|uk drill/.test(blob)) return 'drill';
  if (/trap|rage|plugg|pluggnb|osamason|nettspend/.test(blob)) return 'trap';
  if (/r&b|rnb|soul|neo/.test(blob)) return 'rnb';
  if (/boom.?bap|hip.?hop|lofi|lo-fi/.test(blob)) return 'boombap';
  if (/house|techno|edm|dance/.test(blob)) return 'electronic';
  return 'general';
}

export function buildMusicalTips(input: {
  key?: string | null;
  bpm?: number | null;
  genre?: string | null;
  tags?: string[] | null;
}): MusicalTips {
  const parsed = parseKey(input.key);
  const bpm = typeof input.bpm === 'number' && input.bpm > 0 ? input.bpm : null;
  const style = detectStyle(input.genre, input.tags);

  if (!parsed) {
    return {
      key: input.key || null,
      mode: null,
      root: null,
      scale_notes: [],
      bass_notes: [],
      bass_pattern: [],
      bass_howto: [
        {
          title: 'Тональность',
          body: 'Укажи key лупа (Am, C#, Fmin) — тогда появятся точные ноты для 808.',
        },
        {
          title: 'Пока без key',
          body: 'Слушай самый низкий тон мелодии — чаще это корень. Бас ставь на октаву ниже, в диапазоне ~C1–C2.',
        },
      ],
      chord_ideas: [],
      placement: [
        'Бас и кик не должны бить в одну частоту: sidechain или чуть сдвинь 808 по питчу.',
        'Держи 808 моно ниже 120 Hz, low-pass ~80–150 Hz.',
      ],
      bpm_tip: bpm
        ? `${bpm} BPM — держи 808 в сетке 1/4 или 1/8, не заполняй весь такт длинными нотами.`
        : null,
    };
  }

  const { root, mode } = parsed;
  const scale = mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
  const scaleNotes = scale.map((s) => noteAt(root, s));

  const fifth = noteAt(root, 7);
  const fourth = noteAt(root, 5);
  const sixth = noteAt(root, mode === 'minor' ? 8 : 9);
  const minorThird = noteAt(root, 3);
  const majorThird = noteAt(root, 4);
  const second = noteAt(root, 2);
  const seventh = noteAt(root, mode === 'minor' ? 10 : 11);

  const bassNotes: BassNoteTip[] = [
    {
      note: `${root}1`,
      role: 'Root',
      beats: '1 · 3',
      tip: `Главная нота 808. Ставь на сильные доли. Октава ${root}1–${root}2 — стандарт для trap/drill.`,
    },
    {
      note: `${fifth}1`,
      role: '5th',
      beats: '2 · 4',
      tip: `Пятая даёт движение без смены тональности. Хорошо между ударами корня или в ответ на лид.`,
    },
    {
      note: `${fourth}1`,
      role: '4th',
      beats: '& · 4',
      tip: `Четвёртая — turnaround: заход перед возвратом в ${root}. Часто слайд ${fourth}→${root}.`,
    },
    {
      note: `${sixth}1`,
      role: mode === 'minor' ? '♭6' : '6th',
      beats: '3 · &',
      tip:
        mode === 'minor'
          ? `Минорная шестая — тёмный цвет. Короткий удар или slide в ${root}.`
          : `Шестая — мягкий lift. Один удар перед дропом, не держи длинно.`,
    },
    {
      note: `${second}1`,
      role: '2nd',
      beats: 'проход',
      tip: `Вторая — проходная. Используй на 1/16 между ${root} и ${fourth}, не как основную ноту.`,
    },
  ];

  let bassPattern: string[];
  let patternHint: string;

  if (style === 'drill') {
    bassPattern = [root, '—', fourth, root, '—', fifth, sixth, root];
    patternHint = `Drill: паузы важнее нот. Слайд ${fourth}→${root} с конца предыдущего такта.`;
  } else if (style === 'trap') {
    bassPattern = [root, root, '—', fifth, root, sixth, fourth, root];
    patternHint = `Trap: длинный ${root} на 1, короткий ответ на 5-й, slide в корень на 4.`;
  } else if (style === 'rnb') {
    bassPattern = [root, fifth, sixth, fourth, root, second, fifth, root];
    patternHint = `R&B: плавное движение по гамме, меньше агрессивных slides.`;
  } else if (style === 'boombap') {
    bassPattern = [root, '—', fifth, '—', fourth, '—', fifth, root];
    patternHint = `Boom-bap: бас на четвертях, оставляй воздух под снэр.`;
  } else if (style === 'electronic') {
    bassPattern = [root, root, root, root, fifth, fifth, fourth, root];
    patternHint = `Electronic: ровная пульсация 1/4 или 1/8, минимум слайдов.`;
  } else if (mode === 'minor') {
    bassPattern = [root, root, fifth, fourth, root, sixth, fifth, root];
    patternHint = `Минор: держись ${root} / ${fifth} / ${fourth}, ${sixth} — только как цвет.`;
  } else {
    bassPattern = [root, fifth, sixth, fourth, root, fifth, fourth, root];
    patternHint = `Мажор: классический ход ${root}–${fifth}–${sixth}–${fourth}.`;
  }

  const bassHowto = [
    {
      title: 'Октава',
      body: `Пиши 808 на ${root}1–${root}2 (примерно MIDI 24–40). Выше ${root}3 бас начнёт конфликтовать с мелодией.`,
    },
    {
      title: 'Сетка',
      body:
        bpm && bpm >= 140
          ? `${bpm} BPM — короткие ноты, чаще 1/8. Не тяни 808 через весь такт.`
          : bpm && bpm >= 100
            ? `${bpm} BPM — основа на 1/4, иногда double-time на хуке.`
            : bpm
              ? `${bpm} BPM — длинные ноты ок, акцент на корне и 5-й.`
              : 'Без BPM: начни с четвертей на 1 и 3, потом усложняй.',
    },
    {
      title: 'Слайды',
      body: `Самый чистый ход: ${fourth} или ${fifth} → ${root}. Старт слайда за 1/8–1/4 до сильной доли.`,
    },
    {
      title: 'Микс',
      body: `Low-pass 808 ~80–120 Hz, mono ниже 120 Hz, sidechain на кик. Не ставь бас и кик в один семпл-пик без ducking.`,
    },
    {
      title: 'С мелодией',
      body: `Если лид играет ${scaleNotes.slice(0, 4).join(', ')} — бас почти всегда ${root}, иногда ${fifth}/${fourth}. Избегай ${seventh} под долгим лидом на корне.`,
    },
  ];

  const chordIdeas =
    mode === 'minor'
      ? [
          `${root}m – ${fourth} – ${sixth} – ${fifth}`,
          `${root}m – ${sixth} – ${fourth} – ${fifth}`,
          `${root}m – ${minorThird} – ${fourth} – ${fifth}`,
        ]
      : [
          `${root} – ${fifth} – ${sixth}m – ${fourth}`,
          `${root} – ${fourth} – ${fifth} – ${root}`,
          `${root} – ${majorThird}m – ${fourth} – ${fifth}`,
        ];

  const placement = [
    patternHint,
    `Корень трека — ${root} ${mode === 'minor' ? 'minor' : 'major'}. 80% баса должно быть на ${root}.`,
    `Безопасный набор нот: ${root}, ${fifth}, ${fourth}, ${sixth}. Остальное — редко и коротко.`,
    style === 'drill' || style === 'trap'
      ? 'Длинный 808 + короткий ghost на offbeat звучит плотнее, чем плотная заливка.'
      : 'Оставляй паузы: бас читается лучше, когда есть тишина между ударами.',
  ];

  let bpmTip: string | null = null;
  if (bpm) {
    if (bpm >= 150) {
      bpmTip = `${bpm} BPM — быстрый темп: бас короче, акцент на корне, слайды резче.`;
    } else if (bpm >= 130) {
      bpmTip = `${bpm} BPM — trap/drill зона: 808 на 1, ответ на 3 или 4.`;
    } else if (bpm >= 100) {
      bpmTip = `${bpm} BPM — mid-tempo: можно тянуть ${root} полтакта, потом уйти в ${fifth}.`;
    } else {
      bpmTip = `${bpm} BPM — медленный: длинные ноты, минимум нот в такте.`;
    }
  }

  return {
    key: `${root}${mode === 'minor' ? 'm' : ''}`,
    mode,
    root,
    scale_notes: scaleNotes,
    bass_notes: bassNotes,
    bass_pattern: bassPattern,
    bass_howto: bassHowto,
    chord_ideas: chordIdeas,
    placement,
    bpm_tip: bpmTip,
  };
}
