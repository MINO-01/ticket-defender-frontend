import type { ReactNode } from 'react'
import styles from './DataTable.module.css'

type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
}

type DataTableProps<T> = {
  caption: string
  columns: Column<T>[]
  rows: T[]
  getRowKey: (row: T) => string | number
  emptyMessage?: string
}

export function DataTable<T>({ caption, columns, rows, getRowKey, emptyMessage = '표시할 항목이 없습니다.' }: DataTableProps<T>) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={Math.max(columns.length, 1)} className={styles.empty}>{emptyMessage}</td></tr>
            : rows.map((row) => <tr key={getRowKey(row)}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}
