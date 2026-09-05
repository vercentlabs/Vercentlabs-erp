import Link from "next/link";

import styles from "./experience-kernel.module.css";

export type TabItem = {
  href: string;
  label: string;
  current?: boolean;
  count?: number;
};

export function Tabs({ items, label = "Record sections" }: { items: TabItem[]; label?: string }) {
  return (
    <nav className={styles.tabs} aria-label={label} data-erp-ui="tabs">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.current ? styles.tabCurrent : styles.tab}
          aria-current={item.current ? "page" : undefined}
        >
          <span>{item.label}</span>
          {typeof item.count === "number" ? (
            <span className={styles.tabCount} aria-label={`${item.count} items`}>
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
