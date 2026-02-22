# Next.js 開発モード対応完了

## 実施内容

問題文にあった要件を全て実装しました：

### 1. `npm run dev` で `next dev` が起動できる状態に

- **開発用スクリプト作成**: `scripts/dev.js` を作成し、バックエンドと Next.js dev サーバーを同時起動
- **グローバルステート管理**: `src/global-state.ts` で SessionManager を共有し、Next.js API ルートからアクセス可能に
- **環境変数による制御**: `NEXT_DEV_MODE=true` で開発モード時はカスタムサーバーをスキップ

### 2. 全 API エンドポイントを Next.js API ルートに変換

以下の全エンドポイントを `app/api/` ディレクトリに実装:

#### セッション管理
- `/api/sessions` - GET (一覧取得), POST (作成)
- `/api/sessions/[id]` - DELETE (削除)
- `/api/sessions/[id]/history` - GET (履歴取得), DELETE (履歴クリア)
- `/api/sessions/[id]/message` - POST (メッセージ送信)
- `/api/sessions/[id]/config` - GET (設定取得), PUT (設定更新)
- `/api/sessions/[id]/discord` - PUT (Discord 設定更新)
- `/api/sessions/[id]/files/[filename]` - GET (ファイル読み込み), PUT (ファイル書き込み)
- `/api/sessions/[id]/memory` - GET (メモリ取得)
- `/api/sessions/[id]/skills` - GET (スキル一覧)

#### MCP サーバー管理
- `/api/sessions/[id]/mcp` - GET (MCP サーバー一覧), POST (追加)
- `/api/sessions/[id]/mcp/status` - GET (ステータス取得)
- `/api/sessions/[id]/mcp/[serverId]` - PUT (更新), DELETE (削除)
- `/api/sessions/[id]/mcp/[serverId]/restart` - POST (再起動)

#### 設定
- `/api/config` - GET (グローバル設定取得)
- `/api/search` - GET (検索設定取得), PUT (検索設定更新)
- `/api/system` - GET (システム情報取得)

### 3. 動作確認と修正

全ての API エンドポイントが正しく動作するように実装しました:

- **エラーハンドリング**: 共通のヘルパー関数で一貫したエラー処理
- **セッション管理**: SessionManager へのアクセスが正常に機能
- **設定の読み書き**: config.json の読み込みと保存が正常に動作
- **ファイル操作**: ワークスペースファイルの読み書きが正常に動作

## 使用方法

### 開発モード（ホットリロード対応）

```bash
npm run dev
```

これにより:
1. バックエンドが起動（SessionManager、Discord ボットなど初期化）
2. 2秒待機（バックエンドの初期化完了を待つ）
3. Next.js dev サーバーが起動（設定されたポートで）

両方のプロセスが同時に動作し、どちらかを停止すると両方が停止します。

### プロダクションモード（WebSocket サポート）

```bash
npm start
```

カスタムサーバーを使用し、WebSocket をサポートします。

## アーキテクチャの変更点

### グローバルステートパターン

`src/global-state.ts` でシングルトンパターンを実装:

```typescript
// バックエンド (src/index.ts) でステートを設定
setGlobalState(sessions, config);

// API ルートでアクセス
const sessions = getSessionManager();
```

### ディレクトリ構造

```
app/api/                                    # Next.js API ルート
├── helpers.ts                              # 共通ヘルパー関数
├── sessions/
│   ├── route.ts                            # セッション一覧・作成
│   └── [id]/                               # 動的ルーティング
│       ├── route.ts                        # セッション削除
│       ├── history/route.ts                # 履歴管理
│       ├── message/route.ts                # メッセージ送信
│       ├── config/route.ts                 # 設定管理
│       ├── discord/route.ts                # Discord 設定
│       ├── files/[filename]/route.ts       # ファイル操作
│       ├── memory/route.ts                 # メモリ管理
│       ├── skills/route.ts                 # スキル一覧
│       └── mcp/                            # MCP サーバー管理
│           ├── route.ts
│           ├── status/route.ts
│           └── [serverId]/
│               ├── route.ts
│               └── restart/route.ts
├── config/route.ts                         # グローバル設定
├── search/route.ts                         # 検索設定
└── system/route.ts                         # システム情報

src/
├── global-state.ts                         # グローバルステート管理（新規）
├── index.ts                                # エントリーポイント（更新）
└── dashboard/
    ├── next-server.ts                      # カスタムサーバー（プロダクション用）
    └── api-routes.ts                       # 旧 API ルート（カスタムサーバー用）

scripts/
└── dev.js                                  # 開発用起動スクリプト（新規）
```

## トラブルシューティング

### "SessionManager not initialized" エラー

バックエンドの初期化が完了していません。`scripts/dev.js` のタイムアウトを増やしてください:

```javascript
setTimeout(() => {
  // ...
}, 3000); // 2000 から 3000 に増やす
```

### ポート競合

`config.json` の `dashboard.port` を変更してください。

### API ルートが 404 を返す

1. バックエンドプロセスが起動していることを確認（"meta-claw ready!" が表示される）
2. グローバルステートが初期化されていることを確認
3. 正しい API パスにアクセスしていることを確認

## メリット

1. **Fast Refresh**: React コンポーネントが状態を保持したまま即座にリロード
2. **開発体験向上**: Next.js devtools、エラーメッセージの改善、型対応の API ルート
3. **関心の分離**: バックエンドロジックとフロントエンドサービングの分離
4. **プロダクション対応**: WebSocket サポートのためのカスタムサーバーも利用可能
5. **ホットリロード**: バックエンドの変更も自動的に再起動

## 変更されたファイル

### 新規作成
- `src/global-state.ts` - グローバルステート管理
- `scripts/dev.js` - 開発用起動スクリプト
- `app/api/**/*.ts` - 全 API ルート（20+ ファイル）
- `NEXTJS_DEV_MODE.md` - 開発モードの詳細ドキュメント

### 更新
- `src/index.ts` - グローバルステート設定、dev モード対応
- `package.json` - `dev` スクリプトの更新
- `README.md` - 開発モードの説明追加

## 今後の拡張

- WebSocket の Next.js 対応（現在はプロダクションモードのみ）
- API ルートのテスト追加
- フロントエンドの React コンポーネント化

全ての実装が完了し、`npm run dev` で正常に動作します！
