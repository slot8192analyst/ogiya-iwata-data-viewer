import type { NavItem } from '@/types/navigation'

export const navItems: NavItem[] = [
  { path: '/', label: 'ホーム', description: 'サイトの概要とショートカット' },
  { path: '/daily', label: '日別データ', description: '日別の稼働データを確認' },
  { path: '/aim', label: '狙い台作成', description: '狙い台リストを作成' },
  { path: '/analysis', label: '解析', description: '機種別の解析情報' },
  { path: '/calendar', label: 'カレンダー', description: 'イベント・データをカレンダー表示' },
  { path: '/island', label: '島図', description: '島単位のヒートマップ表示' },
  { path: '/promotion', label: '取材ハブ', description: '取材記事・関連ページ一覧' },
]
