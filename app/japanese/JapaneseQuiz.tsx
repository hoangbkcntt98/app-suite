"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type Choice = { prompt: string; answer: string };

export default function JapaneseQuiz({ choices }: { choices: Choice[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const quiz = choices[0];
  const options = useMemo(() => {
    if (!quiz) return [];
    return [...choices].sort((a, b) => a.prompt.localeCompare(b.prompt));
  }, [choices, quiz]);
  if (!quiz) return null;
  const done = selected !== null;
  return <article className={styles.quizCard}>
    <div className={styles.sectionTop}><span>QUIZ NHANH · 01</span><span>~30 GIÂY</span></div>
    <p className={styles.quizPrompt}>Nghĩa của từ này là gì?</p>
    <h2>{quiz.prompt}</h2>
    <div className={styles.options}>{options.map((option) => {
      const correct = option.answer === quiz.answer;
      const state = done ? (correct ? styles.correct : selected === option.answer ? styles.wrong : "") : "";
      return <button className={state} key={option.prompt} onClick={() => setSelected(option.answer)} disabled={done}>{option.answer}</button>;
    })}</div>
    {done ? <p className={styles.answer}>{selected === quiz.answer ? "Đúng rồi. Tiếp tục giữ nhịp!" : `Đáp án: ${quiz.answer}`}</p> : null}
  </article>;
}
