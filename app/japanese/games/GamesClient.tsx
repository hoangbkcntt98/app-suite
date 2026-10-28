"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type Card = { label: string; answer: string };
type GameKey = "words" | "kanji" | "grammar";
type Game = { key: GameKey; name: string; kicker: string; icon: string; prompt: string; color: string };

const games: Game[] = [
  { key: "words", name: "Word Blitz", kicker: "TỪ VỰNG", icon: "⚡", prompt: "Nghĩa của từ này là gì?", color: "orange" },
  { key: "kanji", name: "Kanji Rush", kicker: "KANJI", icon: "火", prompt: "Kanji này mang nghĩa gì?", color: "green" },
  { key: "grammar", name: "Grammar Sprint", kicker: "NGỮ PHÁP", icon: "文", prompt: "Mẫu ngữ pháp này diễn tả gì?", color: "blue" },
];

function shuffled<T>(items: T[]) { return [...items].sort(() => Math.random() - .5); }

export default function GamesClient({ deck }: { deck: Record<GameKey, Card[]> }) {
  const [active, setActive] = useState<GameKey | null>(null);
  const [step, setStep] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const game = games.find((item) => item.key === active);
  const cards = active ? deck[active] : [];
  const card = cards[step];
  const options = useMemo(() => card ? shuffled([card.answer, ...cards.filter((item) => item.answer !== card.answer).slice(0, 3).map((item) => item.answer)]) : [], [card, cards, step]);

  function start(key: GameKey) { setActive(key); setStep(0); setScore(0); setStreak(0); setSelected(null); }
  function pick(answer: string) {
    if (!card || selected) return;
    setSelected(answer);
    if (answer === card.answer) { setScore((value) => value + 10); setStreak((value) => value + 1); } else setStreak(0);
  }
  function next() { setStep((value) => value + 1); setSelected(null); }

  if (!active) return <section className={styles.gameGrid}>{games.map((item) => <button key={item.key} onClick={() => start(item.key)} className={`${styles.gameCard} ${styles[item.color]}`}><span>{item.icon}</span><small>{item.kicker}</small><strong>{item.name}</strong><p>{item.key === "words" ? "Đoán nghĩa từ trong 30 giây." : item.key === "kanji" ? "Nhận mặt chữ, chọn nghĩa chuẩn." : "Củng cố sắc thái mẫu N1."}</p><b>Chơi ngay →</b></button>)}</section>;
  if (!card) return <section className={styles.result}><span>🏆</span><p>{game?.name}</p><h2>Hoàn thành!</h2><strong>{score} XP</strong><small>Chuỗi cao nhất lượt này: {streak}</small><button onClick={() => start(active)}>Chơi lại</button><button className={styles.ghost} onClick={() => setActive(null)}>Chọn game khác</button></section>;

  return <section className={styles.arena}>
    <div className={styles.arenaTop}><button className={styles.exit} onClick={() => setActive(null)}>×</button><div className={styles.progress}><i style={{ width: `${((step + 1) / cards.length) * 100}%` }} /></div><span>🔥 {streak}</span><b>{score} XP</b></div>
    <div className={styles.question}><span className={`${styles.questionIcon} ${styles[game?.color || "orange"]}`}>{game?.icon}</span><p>{game?.prompt}</p><h2>{card.label}</h2><small>{step + 1} / {cards.length}</small></div>
    <div className={styles.answers}>{options.map((answer, index) => {
      const state = selected ? (answer === card.answer ? styles.correct : selected === answer ? styles.wrong : "") : "";
      return <button key={`${answer}-${index}`} className={state} disabled={Boolean(selected)} onClick={() => pick(answer)}><i>{String.fromCharCode(65 + index)}</i>{answer}</button>;
    })}</div>
    {selected ? <div className={`${styles.feedback} ${selected === card.answer ? styles.good : styles.bad}`}><span>{selected === card.answer ? "Chuẩn luôn! +10 XP" : `Đáp án: ${card.answer}`}</span><button onClick={next}>Tiếp tục →</button></div> : null}
  </section>;
}
