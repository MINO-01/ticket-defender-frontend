import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, ElementDefinition } from 'cytoscape'
import type { GraphModel } from './track1Model'
import styles from './Track1.module.css'

function positionsFor(graph: GraphModel, compact: boolean) {
  const positions = new Map<string, { x: number; y: number }>()
  const columns = [
    graph.nodes.filter((node) => node.kind === 'account'),
    graph.nodes.filter((node) => node.kind === 'signal'),
    graph.nodes.filter((node) => node.kind === 'reservation'),
  ]
  columns.forEach((nodes, column) => nodes.forEach((node, index) => positions.set(node.id, compact
    ? { x: 60 + column * 100, y: 80 + index * 72 }
    : { x: 120 + column * 205, y: 90 + index * 78 })))
  return positions
}

export function ClusterGraph({ graph, selectedId, onSelect }: { graph: GraphModel; selectedId: string | null; onSelect: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<Core | null>(null)
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!containerRef.current) return
    const compact = window.innerWidth <= 700
    const positions = positionsFor(graph, compact)
    const elements: ElementDefinition[] = [
      ...graph.nodes.map((node) => ({ data: { id: node.id, label: node.graphLabel, kind: node.kind }, position: positions.get(node.id) })),
      ...graph.edges.map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, kind: edge.signalKind ?? 'reservation' } })),
    ]
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: { name: 'preset', fit: true, padding: compact ? 20 : 32 },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      style: [
        { selector: 'node', style: { 'label': 'data(label)', 'background-color': '#2785e6', 'color': '#0f172a', 'font-size': 13, 'text-valign': 'bottom', 'text-margin-y': 8, 'text-wrap': 'ellipsis', 'text-max-width': '80px', 'width': 34, 'height': 34 } },
        { selector: 'node[kind = "signal"]', style: { 'background-color': '#f5af45', 'shape': 'diamond' } },
        { selector: 'node[kind = "reservation"]', style: { 'background-color': '#93b8da', 'shape': 'round-rectangle', 'width': 26, 'height': 26 } },
        { selector: 'edge', style: { 'width': 2, 'line-color': '#a7b8cd', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#a7b8cd' } },
        { selector: '.related', style: { 'line-color': '#2785e6', 'target-arrow-color': '#2785e6', 'border-color': '#2785e6', 'border-width': 2 } },
        { selector: ':selected', style: { 'background-color': '#155496', 'line-color': '#155496', 'target-arrow-color': '#155496', 'width': 5 } },
      ],
    })
    const select = (event: cytoscape.EventObject) => onSelectRef.current(event.target.id())
    cy.on('tap', 'node, edge', select)
    const resize = () => {
      const nextCompact = window.innerWidth <= 700
      const nextPositions = positionsFor(graph, nextCompact)
      cy.nodes().positions((node) => nextPositions.get(node.id()) ?? node.position())
      cy.resize()
      cy.fit(undefined, nextCompact ? 20 : 32)
    }
    window.addEventListener('resize', resize)
    instanceRef.current = cy
    return () => { window.removeEventListener('resize', resize); cy.off('tap', 'node, edge', select); cy.destroy(); instanceRef.current = null }
  }, [graph])

  useEffect(() => {
    const cy = instanceRef.current
    if (!cy) return
    cy.elements().unselect().removeClass('related')
    if (selectedId) {
      const element = cy.$id(selectedId)
      element.select()
      element.neighborhood().addClass('related')
    }
  }, [selectedId, graph])

  const zoom = (factor: number) => {
    const cy = instanceRef.current
    if (cy) cy.zoom(Math.max(0.25, Math.min(3, cy.zoom() * factor)))
  }

  return <div className={styles.graphArea}>
    <div className={styles.graphToolbar} aria-label="그래프 보기 조정">
      <button type="button" aria-label="그래프 확대" onClick={() => zoom(1.2)}>+</button>
      <button type="button" aria-label="그래프 축소" onClick={() => zoom(1 / 1.2)}>−</button>
      <button type="button" onClick={() => instanceRef.current?.fit(undefined, 32)}>전체 보기</button>
    </div>
    <div ref={containerRef} className={styles.graphCanvas} role="img" aria-label="계정, 예매와 공유 연결 정보의 관계 그래프. 아래 목록에서도 모든 근거를 선택할 수 있습니다." />
    <p className={styles.graphHelp}>드래그하여 이동하고 마우스 휠이나 버튼으로 확대할 수 있습니다. 키보드로는 아래 목록을 이용하세요.</p>
  </div>
}
