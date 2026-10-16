import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import styles from './FormControls.module.css'

type FieldProps = { label: string; error?: string }
type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldProps
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps
type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldProps

function descriptionId(id: string, error?: string, describedBy?: string) {
  return [describedBy, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, id, required, disabled, 'aria-describedby': describedBy, ...props }, ref) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>{label}{required && <span className={styles.required}> *</span>}</label>
      <input {...props} ref={ref} id={fieldId} className={styles.control} required={required} disabled={disabled} aria-invalid={!!error || undefined} aria-describedby={descriptionId(fieldId, error, describedBy)} />
      {error && <p id={`${fieldId}-error`} className={styles.error}>{error}</p>}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, id, required, disabled, 'aria-describedby': describedBy, ...props }, ref) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>{label}{required && <span className={styles.required}> *</span>}</label>
      <textarea {...props} ref={ref} id={fieldId} className={`${styles.control} ${styles.textarea}`} required={required} disabled={disabled} aria-invalid={!!error || undefined} aria-describedby={descriptionId(fieldId, error, describedBy)} />
      {error && <p id={`${fieldId}-error`} className={styles.error}>{error}</p>}
    </div>
  )
})

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, id, required, disabled, 'aria-describedby': describedBy, children, ...props }, ref) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.label}>{label}{required && <span className={styles.required}> *</span>}</label>
      <select {...props} ref={ref} id={fieldId} className={styles.control} required={required} disabled={disabled} aria-invalid={!!error || undefined} aria-describedby={descriptionId(fieldId, error, describedBy)}>{children}</select>
      {error && <p id={`${fieldId}-error`} className={styles.error}>{error}</p>}
    </div>
  )
})
