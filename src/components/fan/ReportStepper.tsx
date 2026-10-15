import styles from './ReportStepper.module.css'

const steps = ['안내', '작성', '확인', '완료']

export function ReportStepper({ currentStep }: { currentStep: number }) {
  return <nav aria-label="제보 진행 단계" className={styles.stepper}><ol>{steps.map((step, index) => <li key={step} className={index === currentStep ? styles.current : index < currentStep ? styles.done : ''} aria-current={index === currentStep ? 'step' : undefined}><span className={styles.number}>{index + 1}</span><span>{step}</span></li>)}</ol></nav>
}
