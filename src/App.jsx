import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Terminology:
// - Pitch class: note letter without octave (e.g., C, C#, D ...)
// - Pitch: a specific note with octave (e.g., G#4)

// ----- Soundfont instruments -----
export const INSTRUMENTS = [
  "accordion",
  "acoustic_bass",
  "acoustic_guitar_nylon",
  "acoustic_guitar_steel",
  "alto_sax",
  "baritone_sax",
  "bright_acoustic_piano",
  "celesta",
  "choir_aahs",
  "church_organ",
  "clarinet",
  "contrabass",
  "distortion_guitar",
  "electric_piano_1",
  "english_horn",
  "french_horn",
  "fretless_bass",
  "fx_4_atmosphere",
  "koto",
  "lead_8_bass__lead",
  "music_box",
  "oboe",
  "overdriven_guitar",
  "pad_4_choir",
  "pan_flute",
  "soprano_sax",
  "string_ensemble_1",
  // "synth_choir",
  "tremolo_strings",
  "tuba",
  "tubular_bells",
  "vibraphone",
  "voice_oohs",
];

function computePeakNormalizationGain(instrument) {

    let chosenGain = 1;
    const buffers = instrument && instrument.buffers;
    if (!buffers || typeof buffers !== "object") {
        return chosenGain;
    }
    const entries = Object.values(buffers);
    let globalPeak = 0;
    for (const buf of entries) {
        if (!buf) continue;
        let peak = 0;
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < data.length; i++) {
                const a = Math.abs(data[i]);
                if (a > peak) peak = a;
            }
        }
        if (peak > globalPeak) globalPeak = peak;
    }
    chosenGain = globalPeak > 0 ? 1 / globalPeak : 1;
    return chosenGain;
}

// ----- Constants -----
// Use full 12-note set with sharps (pitch classes)
const PITCH_CLASSES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const PITCH_CLASS_TO_PC = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const MIN_MIDI = 45; // A2
const MAX_MIDI = 79; // G5

// ----- Soundfont-Player loader and playback -----
let soundfontModule = null;
let sfCtx = null;
const sfCache = new Map();
async function ensureSoundfont() {
  if (!soundfontModule) {
    const mod = await import('https://cdn.skypack.dev/soundfont-player');
    soundfontModule = mod.default || mod;
  }
  return soundfontModule;
}
async function ensureAudioCtx() {
  if (!sfCtx) sfCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sfCtx;
}
async function loadInstrument(instrumentName) {
  const Soundfont = await ensureSoundfont();
  const ac = await ensureAudioCtx();
  if (!sfCache.has(instrumentName)) {
    const inst = await Soundfont.instrument(ac, instrumentName, { soundfont: 'MusyngKite' });
    // Compute and attach a normalization gain based on peak amplitude
    try {
      inst._normalizationGain = computePeakNormalizationGain(inst) || 1;
    } catch {
      inst._normalizationGain = 1;
    }
    sfCache.set(instrumentName, inst);
  }
  const cached = sfCache.get(instrumentName);
  // Ensure normalization gain exists even if this instance was cached before this change
  if (typeof cached?._normalizationGain !== 'number') {
    try { cached._normalizationGain = computePeakNormalizationGain(cached) || 1; } catch { cached._normalizationGain = 1; }
  }
  return cached;
}
async function playNoteName(instrumentName, noteName) {
  const inst = await loadInstrument(instrumentName);
  const ac = await ensureAudioCtx();
  const gain = typeof inst._normalizationGain === 'number' ? inst._normalizationGain : 1.0;
  inst.play(noteName, ac.currentTime, { gain, duration: 1.0 });
}

// ----- Storage helpers -----
const LS_KEYS = {
  selected: "pt_selectedNotes",
  history: "pt_history",
};

function loadSelected() {
  const raw = localStorage.getItem(LS_KEYS.selected);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  // Default to C and two equally spaced pitch classes (every 4 semitones): C, E, G#
  return { C: true, E: true, "G#": true };
}
function saveSelected(sel) { localStorage.setItem(LS_KEYS.selected, JSON.stringify(sel)); }
function loadHistory() {
  const raw = localStorage.getItem(LS_KEYS.history);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}
function saveHistory(arr) { localStorage.setItem(LS_KEYS.history, JSON.stringify(arr)); }

// ----- MIDI / Note helpers -----
function midiFromPitchClass(pitchClassLabel, octave) {
  const pc = PITCH_CLASS_TO_PC[pitchClassLabel];
  return 12 * (octave + 1) + pc;
}
function pitchFromMidi(midi) {
  const pc = midi % 12; const octave = Math.floor(midi / 12) - 1;
  const entries = Object.entries(PITCH_CLASS_TO_PC);
  const pitchClass = entries.find(([, pitch]) => pitch === pc)?.[0] || "";
  return { pitchClass, octave };
}
function freqFromMidi(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function validMidisForPitchClass(pitchClass) {
  const midiList = [];
  for (let octave = 0; octave <= 8; octave++) {
    const midi = midiFromPitchClass(pitchClass, octave);
    if (midi >= MIN_MIDI && midi <= MAX_MIDI) midiList.push(midi);
  }
  return midiList;
}
function nearestMidiForPitchClass(pitchClass, targetMidi) {
  const candidateMidis = validMidisForPitchClass(pitchClass);
  if (!candidateMidis.length) return null;
  let bestMidi = candidateMidis[0];
  let bestDiffAbs = Math.abs(bestMidi - targetMidi);
  for (let index = 1; index < candidateMidis.length; index++) {
    const diff = Math.abs(candidateMidis[index] - targetMidi);
    if (diff < bestDiffAbs || (diff === bestDiffAbs && candidateMidis[index] < bestMidi)) { bestMidi = candidateMidis[index]; bestDiffAbs = diff; }
  }
  const { pitchClass: pcLabel, octave } = pitchFromMidi(bestMidi);
  return { midi: bestMidi, pitchClass: pcLabel, octave };
}
function pickRandom(list) { return list[Math.floor(Math.random() * list.length)]; }

// (Old AudioContext-based synthesis removed)

// ----- Stats helpers -----
function isSameDay(tsA, tsB) {
  const a = new Date(tsA), b = new Date(tsB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function summarizeBy(rangeFilter) {
  const history = loadHistory();
  const items = rangeFilter ? history.filter(rangeFilter) : history;
  const byLabel = {}; PITCH_CLASSES.forEach((pitchClass) => (byLabel[pitchClass] = { total: 0, correct: 0 }));
  let totalCount = 0, correctCount = 0;
  items.forEach((item) => {
    const pc = item.pitchClass ?? item.letter; // backwards-compatible read
    if (byLabel[pc]) { byLabel[pc].total += 1; if (item.correct) byLabel[pc].correct += 1; }
    totalCount += 1; if (item.correct) correctCount += 1;
  });
  const rows = PITCH_CLASSES.map((pitchClass) => {
    const total = byLabel[pitchClass].total, correct = byLabel[pitchClass].correct; const pct = total ? Math.round((correct/total)*100) : 0; return { label: pitchClass, total, correct, pct };
  });
  const allPct = totalCount ? Math.round((correctCount/totalCount)*100) : 0;
  return { all: { label: 'All', total: totalCount, correct: correctCount, pct: allPct }, rows };
}

export default function App() {
  const [selected, setSelected] = useState(() => loadSelected());
  const [currentNote, setCurrentNote] = useState(null); // { midi, pitchClass, octave }
  const [postGuess, setPostGuess] = useState(false);
  const [lastGuessLetter, setLastGuessLetter] = useState(null);
  const [lastGuessCorrect, setLastGuessCorrect] = useState(null);
  const [nearestMap, setNearestMap] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const lastPlayedRef = useRef([]); // rolling last 3 midis
  const playBtnRef = useRef(null);
  const statsStateActive = useRef(false); // tracks if we pushed a state for stats
  const nextInstrumentRef = useRef(null); // instrument to use for the NEXT round (prefetched)

  // Pick and prefetch the next instrument to minimize wait on Play
  const selectAndPrefetchNextInstrument = useCallback(async () => {
    const next = pickRandom(INSTRUMENTS);
    nextInstrumentRef.current = next;
    try { await loadInstrument(next); } catch {}
  }, []);

  // On first load, prefetch an instrument for the first round
  useEffect(() => {
    selectAndPrefetchNextInstrument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPitchClasses = useMemo(() => PITCH_CLASSES.filter((pc)=>!!selected[pc]), [selected]);

  const pickTarget = useCallback((excludeMidis = [], prevPitchClass = null) => {
    if (selectedPitchClasses.length === 0) return null;
    // Weighted choice: previous letter has half the weight of any other letter
    let pitchClass;
    if (prevPitchClass && selectedPitchClasses.length > 1 && selectedPitchClasses.includes(prevPitchClass)) {
      const weights = selectedPitchClasses.map((pc) => (pc === prevPitchClass ? 0.5 : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      for (let i = 0; i < selectedPitchClasses.length; i++) {
        if ((r -= weights[i]) <= 0) { pitchClass = selectedPitchClasses[i]; break; }
      }
      if (!pitchClass) pitchClass = selectedPitchClasses[selectedPitchClasses.length - 1];
    } else {
      pitchClass = pickRandom(selectedPitchClasses);
    }
    const candidateMidis = validMidisForPitchClass(pitchClass);
    if (!candidateMidis.length) return null;
    const filteredMidis = candidateMidis.filter((midi)=>!excludeMidis.includes(midi));
    const poolMidis = filteredMidis.length ? filteredMidis : candidateMidis;
    const targetMidi = pickRandom(poolMidis);
    const { octave } = pitchFromMidi(targetMidi);
    return { midi: targetMidi, pitchClass, octave };
  }, [selectedPitchClasses]);

  const renderStatBlock = (summary) => (
    <div className="stat-rows">
      <div className="row strong">
        <div className="name">{summary.all.label}</div>
        <div className="pct">{summary.all.pct}%</div>
        <div className="ratio">{summary.all.correct}/{summary.all.total}</div>
      </div>
      {summary.rows.map(row => (
        <div className="row" key={row.label}>
          <div className="name">{row.label}</div>
          <div className="pct">{row.pct}%</div>
          <div className="ratio">{row.correct}/{row.total}</div>
        </div>
      ))}
    </div>
  );

  const resetRound = () => {
    setPostGuess(false);
    setLastGuessLetter(null);
    setLastGuessCorrect(null);
    setNearestMap(null);
    setCurrentNote(null);
    try { playBtnRef.current?.focus({ preventScroll: true }); } catch {}
  };

  const onToggle = (pitchClass) => {
    const onCount = selectedPitchClasses.length;
    const currentlyOn = !!selected[pitchClass];
    if (currentlyOn && onCount <= 1) return;
    const next = { ...selected, [pitchClass]: !currentlyOn };
    setSelected(next); saveSelected(next);
    // End the current round without affecting stats
    resetRound();
  };

  const onPlayNew = async () => {
    const prevPitchClass = currentNote?.pitchClass || (lastPlayedRef.current.length ? pitchFromMidi(lastPlayedRef.current[lastPlayedRef.current.length - 1]).pitchClass : null);
    const targetNote = pickTarget(lastPlayedRef.current, prevPitchClass);
    if (!targetNote) return;
    setPostGuess(false); setLastGuessLetter(null); setLastGuessCorrect(null); setNearestMap(null);
    const instrument = nextInstrumentRef.current || pickRandom(INSTRUMENTS);
    setCurrentNote({ ...targetNote, instrument });
    // record into rolling last-3
    const nextLast = [...lastPlayedRef.current, targetNote.midi].slice(-3);
    lastPlayedRef.current = nextLast;
    // move focus to Play button to avoid lingering focus rings on guess buttons
    try { playBtnRef.current?.focus({ preventScroll: true }); } catch {}
    // Choose and start prefetching the instrument for the NEXT round right away
    selectAndPrefetchNextInstrument();
    await playNoteName(instrument, `${targetNote.pitchClass}${targetNote.octave}`);
  };

  const onReplay = async () => {
    if (!currentNote) return;
    const instrument = currentNote.instrument || pickRandom(INSTRUMENTS);
    await playNoteName(instrument, `${currentNote.pitchClass}${currentNote.octave}`);
  };

  const recordGuess = (target, guessPitchClass) => {
    const history = loadHistory(); const correct = guessPitchClass === target.pitchClass;
    // Store both pitchClass and legacy 'letter' for backwards compatibility
    history.push({ ts: Date.now(), midi: target.midi, pitchClass: target.pitchClass, letter: target.pitchClass, octave: target.octave, guess: guessPitchClass, correct });
    saveHistory(history); return correct;
  };

  const onGuess = (pitchClass) => {
    if (!currentNote) return;
    const isCorrect = recordGuess(currentNote, pitchClass);
    setLastGuessLetter(pitchClass); setLastGuessCorrect(isCorrect);
    const currentPitchClasses = selectedPitchClasses;
    const nearestByPitchClass = {};
    currentPitchClasses.forEach((pc)=>{ const nearest = nearestMidiForPitchClass(pc, currentNote.midi); if (nearest) nearestByPitchClass[pc]=nearest; });
    setNearestMap(nearestByPitchClass); setPostGuess(true);
  };

  useEffect(() => {
    const onKey = (event) => {
      const isEscape = event.code === 'Escape' || event.key === 'Escape';
      if (isEscape && showStats) { event.preventDefault(); closeStats(); return; }

      const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
      if (!isSpace) return;
      if (showStats) return;
      event.preventDefault();
      // On keyboard interaction, also move focus to Play
      try { playBtnRef.current?.focus({ preventScroll: true }); } catch {}
      if (!postGuess) {
        if (currentNote) onReplay(); else onPlayNew();
      } else {
        onPlayNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [postGuess, currentNote, showStats]);

  // Back button should close stats if open
  useEffect(() => {
    const onPop = () => {
      if (showStats) {
        setShowStats(false);
        statsStateActive.current = false;
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showStats]);

  const openStats = () => {
    if (!statsStateActive.current) {
      try { window.history.pushState({ statsOpen: true }, ''); } catch {}
      statsStateActive.current = true;
    }
    setShowStats(true);
  };

  const closeStats = () => {
    setShowStats(false);
    if (statsStateActive.current) {
      statsStateActive.current = false;
      try { window.history.back(); } catch {}
    }
  };

  const now = Date.now();
  const dayStart = useMemo(() => { const day = new Date(); day.setHours(0,0,0,0); return day; }, []);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const statsAll = summarizeBy();
  const stats7 = summarizeBy((item)=> item.ts >= weekAgo);
  const statsToday = summarizeBy((item)=> isSameDay(item.ts, dayStart.getTime()));

  // Build date injected at build time (UTC ISO string via Vite define)
  const buildDateStr = useMemo(() => {
    const iso = (typeof __BUILD_TIME__ !== 'undefined') ? __BUILD_TIME__ : new Date().toISOString();
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="note-toggle">
          {PITCH_CLASSES.map((pitchClass) => (
            <button key={pitchClass} className={"toggle" + (selected[pitchClass] ? " active" : "")} aria-pressed={selected[pitchClass] ? 'true' : 'false'} onClick={() => onToggle(pitchClass)}>{pitchClass}</button>
          ))}
        </div>
        <div className="toolbar"></div>
      </header>

      <main>
        <section className="quiz">
          <div className="quiz-controls">
            <button
              ref={playBtnRef}
              className="primary"
              onClick={() => { if (currentNote && !postGuess) onReplay(); else onPlayNew(); }}
            >
              {currentNote && !postGuess ? 'Replay note' : 'Play note'}
            </button>
          </div>
          {currentNote && <h2 id="prompt">What note was that?</h2>}
          {(currentNote || postGuess) && (
          <div className={"guess-buttons" + (selectedPitchClasses.length > 8 ? " compact" : "")}>
            {selectedPitchClasses.map((pitchClass) => {
              const isCorrectLetter = currentNote && pitchClass === currentNote.pitchClass;
              const isGuessed = lastGuessLetter === pitchClass;
              const cls = ['btn-note'];
              if (postGuess) {
                if (lastGuessCorrect && isGuessed) cls.push('guessed-correct');
                else if (!lastGuessCorrect) {
                  if (isGuessed) cls.push('guessed-incorrect');
                  if (isCorrectLetter) cls.push('correct-indicator');
                }
              }
              const disabled = !currentNote && !postGuess;
              const onClick = () => {
                if (!postGuess) {
                  // First guess: play the guessed pitch (nearest octave to target) and record the guess
                  if (currentNote) {
                    const nearest = nearestMidiForPitchClass(pitchClass, currentNote.midi);
                    if (nearest) {
                      const instrument = currentNote.instrument || pickRandom(INSTRUMENTS);
                      lastPlayedRef.current = [...lastPlayedRef.current, nearest.midi].slice(-3);
                      playNoteName(instrument, `${nearest.pitchClass}${nearest.octave}`);
                    }
                  }
                  onGuess(pitchClass);
                } else if (nearestMap?.[pitchClass]) {
                  const previewMidi = nearestMap[pitchClass].midi;
                  // add previewed note to recent list
                  lastPlayedRef.current = [...lastPlayedRef.current, previewMidi].slice(-3);
                  const { pitchClass: pc2, octave } = pitchFromMidi(previewMidi);
                  const instrument = currentNote?.instrument || pickRandom(INSTRUMENTS);
                  playNoteName(instrument, `${pc2}${octave}`);
                }
              };
              return <button key={pitchClass} className={cls.join(' ')} onClick={onClick} disabled={disabled}>{pitchClass}</button>;
            })}
          </div>
          )}
          <div id="feedback" className={"feedback" + (postGuess ? (lastGuessCorrect ? ' success' : ' error') : '')}>
            {postGuess && currentNote ? (() => {
              const note = `${currentNote.pitchClass}${currentNote.octave}`;
              const instr = currentNote.instrument ? ` (${currentNote.instrument.replace(/_/g, ' ')})` : '';
              return lastGuessCorrect
                ? `Correct! It was ${note}${instr}.`
                : `Incorrect. It was ${note}${instr}.`;
            })() : ''}
          </div>
        </section>
      </main>

      <div className={"overlay" + (showStats ? '' : ' hidden')} aria-hidden={!showStats} onClick={(event)=>{ if(event.target===event.currentTarget) closeStats(); }}>
        <div className="overlay-content">
          <div className="overlay-header">
            <h3>Your Stats</h3>
            <button aria-label="Close" onClick={closeStats}>✕</button>
          </div>
          <div className="stats-grid">
            <div className="stat"><div className="label">Today</div><div className="value">{renderStatBlock(statsToday)}</div></div>
            <div className="stat"><div className="label">Last 7 Days</div><div className="value">{renderStatBlock(stats7)}</div></div>
            <div className="stat"><div className="label">All Time</div><div className="value">{renderStatBlock(statsAll)}</div></div>
          </div>
          <div className="overlay-footer">
            <div className="app-version" aria-label="Build date">Build: {buildDateStr}</div>
          </div>
        </div>
      </div>

      {/* Floating Stats button bottom-right */}
      <button className="stats-fab" onClick={openStats} aria-label="Stats">Stats</button>
    </>
  );
}
