import styles from "./loading.module.css";

export default function Loading() {
  return (
    <div aria-live="polite" className={styles.overlay} role="status">
      <div aria-hidden="true" className={styles.spinner} />
      <strong>Loading...</strong>
    </div>
  );
}
