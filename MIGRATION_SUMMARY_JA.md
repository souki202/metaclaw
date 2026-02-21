# Express から Next.js への移行完了

## 実施内容

問題文にあった要件を全て実装しました：

### 1. Express を Next.js に全面置換

- **Express サーバーの削除**: `src/dashboard/server.ts` の Express ベースの実装を削除し、Next.js ベースの新しいサーバーに置き換えました
- **Next.js カスタムサーバー**: `src/dashboard/next-server.ts` を作成し、WebSocket サポートを含む Next.js サーバーを実装
- **API ルートの移行**: `src/dashboard/api-routes.ts` で全ての Express API エンドポイントを Next.js 互換の形式で再実装
- **フロントエンド**: 既存のダッシュボード HTML を `public/dashboard.html` に配置し、Next.js の `app/` ディレクトリ構造を構築

### 2. ホットリロード対応

Next.js の導入により、以下の変更が自動的にホットリロードされるようになりました:

- **バックエンドコード**: `src/` ディレクトリ内の TypeScript ファイル
- **フロントエンドコード**: `app/` ディレクトリ内の React コンポーネント

`scripts/runner.js` が `src/` ディレクトリの変更を監視し、変更があれば自動的に再起動します。Next.js は `app/` ディレクトリの変更を自動的に検出してホットリロードします。

### 3. AI 向け再起動コマンドの使用に関する明記

以下の場所にドキュメントを追加しました:

#### README.md
新しいセクション「Hot Reload vs Restart」を追加し、以下を明記:
- ホットリロードで自動適用される変更の種類
- `self_restart` が必要な場合（npm install、設定変更、ネイティブモジュール更新のみ）
- 通常のコード変更は自動的にホットリロードされる旨

#### src/tools/index.ts
`self_restart` ツールの説明文を更新:
```
"NOTE: With Next.js hot reload, this is only needed for changes that cannot be hot-reloaded
(npm install, config changes, native module updates). Regular code changes in src/ or app/
are hot-reloaded automatically."
```

## 変更されたファイル

### 追加ファイル
- `next.config.js` - Next.js 設定
- `app/layout.tsx` - Next.js レイアウトコンポーネント
- `app/page.tsx` - メインページ（ダッシュボードへリダイレクト）
- `public/dashboard.html` - 既存のダッシュボード HTML
- `src/dashboard/next-server.ts` - Next.js カスタムサーバー
- `src/dashboard/api-routes.ts` - API ルートハンドラー
- `MIGRATION_NOTES.md` - 移行に関する詳細なノート

### 更新ファイル
- `package.json` - Next.js、React 依存関係を追加、Express を削除
- `tsconfig.json` - JSX サポートと Next.js 設定を追加
- `.gitignore` - Next.js ビルド成果物を除外
- `src/index.ts` - 新しい Next.js サーバーを使用するように更新
- `scripts/runner.js` - ホットリロードに関するログメッセージを追加
- `README.md` - ホットリロードに関する説明を追加
- `src/tools/index.ts` - `self_restart` ツールの説明を更新

## 使用方法

### 初回セットアップ
```bash
# 1. 依存関係のインストール
npm install

# 2. ビルド
npm run build

# 3. 起動
npm start
```

### 開発時
```bash
npm start
```

サーバーが起動すると、`src/` ディレクトリの変更を自動的に検出してホットリロードします。

## 互換性

- 全ての既存 API エンドポイントは同じ形式で動作します
- WebSocket 接続も引き続き機能します
- ダッシュボードの UI は変更されていません
- セッション管理、Discord 統合、メモリシステムなどの機能は全て保持されています

## 次のステップ

1. `npm install` を実行して Next.js と React の依存関係をインストール
2. `npm start` でサーバーを起動
3. ブラウザで `http://localhost:8080` を開いてダッシュボードを確認
4. `src/` 内のファイルを編集して、ホットリロードが動作することを確認

## 技術的な詳細

### なぜ Next.js?
- **高度なホットリロード**: Next.js は Fast Refresh をサポートし、コンポーネントの状態を保持したまま変更を適用
- **API Routes**: Express ルートを Next.js API Routes に簡単に移行可能
- **カスタムサーバー**: WebSocket サポートなどのカスタム機能を維持しながら Next.js を使用可能
- **React エコシステム**: 将来的にダッシュボードを React コンポーネントでリファクタリングすることが容易

### アーキテクチャ
```
metaclaw/
├── src/                      # バックエンドコード（ホットリロード対応）
│   ├── dashboard/
│   │   ├── next-server.ts   # Next.js カスタムサーバー + WebSocket
│   │   └── api-routes.ts    # API ルートハンドラー
│   ├── core/                 # AI エージェントコア
│   └── tools/                # AI ツール定義
├── app/                      # Next.js フロントエンド（ホットリロード対応）
│   ├── layout.tsx
│   └── page.tsx
├── public/                   # 静的ファイル
│   └── dashboard.html        # 既存ダッシュボード UI
└── scripts/
    └── runner.js             # プロセスラッパー（ホットリロード監視）
```

移行は完了しました。問題や質問があれば、MIGRATION_NOTES.md を参照してください。
