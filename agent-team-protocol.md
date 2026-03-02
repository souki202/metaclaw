# AI Agent Team Coordination Protocol

> **前提**: グループチャット、メンション割り込み、Agent間メッセージ機能は実装済み。  
> 本ドキュメントは、その上に載せる **AI最適化された連携レイヤー** を定義する。

---

## 1. Shared State Board（共有ステートボード）

### 目的

チャットログの時系列を遡るのではなく、**プロジェクトの「現在の状態」を構造化された単一ドキュメントとして常時保持**する。各Agentは自分のターンの開始時にこのボードを読み、終了時に更新する。

### スキーマ

```yaml
project_state:
  goal: string             # プロジェクトの最終目標
  current_phase: string    # 現在のフェーズ名
  updated_at: ISO8601      # 最終更新タイムスタンプ

  agents:
    - id: string           # Agent識別子（例: "agent-designer"）
      role: string         # 担当領域の説明
      status: enum         # idle | working | blocked | completed | error
      current_task: string | null
      blocked_by: string | null      # block原因（他Agentのタスク参照 or 外部要因）
      artifacts:                      # このAgentが生成した成果物
        - ref: string                 # 成果物の参照ID
          description: string
          version: int
          path: string               # ファイルパスやURI

  pending_decisions:
    - id: string           # 意思決定ID（例: "D-012"）
      question: string     # 何を決める必要があるか
      options:             # 選択肢（わかっている場合）
        - label: string
          pros: string
          cons: string
      owner: string        # 決定責任を持つAgent ID
      deadline: string | null
      status: enum         # open | resolved
      resolution: string | null

  blockers:
    - id: string
      description: string
      affected_agents: [string]
      created_at: ISO8601
      resolved: bool

  changelog:               # 直近N件のステート変更差分
    - timestamp: ISO8601
      agent: string
      action: string       # 人間可読な変更の要約
      diff_summary: string # 何が変わったかの構造的な要約
```

### 運用ルール

- **Read-on-Entry**: 各Agentはタスク開始時に `project_state` を読み込む。チャットログではなくこのボードが「現在の真実」である。
- **Write-on-Exit**: タスク完了・中断・ブロック発生時にステートを更新する。
- **Changelog必須**: ステート更新時は必ず `changelog` にエントリを追加する。他Agentはchangelogの差分だけを読めば、前回以降の変化を把握できる。
- **コンフリクト防止**: 同一フィールドへの同時書き込みが発生した場合、タイムスタンプが新しい方を優先し、古い方のAgentに再読み込みを通知する。

---

## 2. Typed Message Protocol（型付きメッセージプロトコル）

### 目的

自然言語チャットの曖昧さを排除し、**メッセージの意図・期待される応答・緊急度を構造化する**。既存のAgent間メッセージ機能の上に、このプロトコルを載せる。

### メッセージ共通ヘッダ

```yaml
message:
  id: string               # メッセージ一意ID
  type: enum               # 後述のメッセージ型
  from: string             # 送信Agent ID
  to: string | [string]    # 宛先Agent ID（複数可）またはグループID
  priority: enum           # blocking | high | normal | low
  timestamp: ISO8601
  context_summary: string  # このメッセージの背景を1-2文で要約
  related_state_refs:      # Shared State Boardの関連エントリへの参照
    - type: enum           # agent | decision | blocker | artifact
      id: string
```

### メッセージ型一覧

#### `TASK_HANDOFF` — タスク引き継ぎ

```yaml
type: TASK_HANDOFF
payload:
  task_description: string       # 何をしてほしいか
  input_artifacts: [string]      # 入力となる成果物の参照ID
  expected_output:
    format: string               # 期待する出力形式（例: "TypeScriptファイル", "レビューコメント"）
    success_criteria: [string]   # 完了条件のリスト
  constraints: [string]          # 守るべき制約（例: "既存APIとの後方互換性を維持"）
  authority_scope: string        # 受け手が自律判断してよい範囲の説明
  fallback_on_failure: string    # 完遂できない場合の指示（例: "部分的な成果を返して差分を報告"）
expected_response_type: TASK_RESULT | TASK_BLOCKED
```

#### `TASK_RESULT` — タスク完了報告

```yaml
type: TASK_RESULT
payload:
  original_task_ref: string      # 元のTASK_HANDOFFメッセージID
  status: enum                   # completed | partial | failed
  output_artifacts: [string]     # 生成した成果物の参照ID
  summary: string                # 何をやったかの要約
  deviations: [string] | null    # 元の要件からの逸脱があれば記載
  open_questions: [string] | null # 残った疑問点
```

#### `DECISION_REQUEST` — 意思決定の依頼

```yaml
type: DECISION_REQUEST
payload:
  decision_id: string            # Shared State Boardのpending_decisions.idと紐づく
  question: string
  options:
    - label: string
      analysis: string           # 各選択肢の分析
      recommendation_score: float | null  # 0.0-1.0（推奨度、任意）
  recommended: string | null     # 推奨する選択肢のlabel
  deadline_steps: int | null     # 何ステップ以内に回答が必要か
expected_response_type: DECISION_RESULT
```

#### `DECISION_RESULT` — 意思決定の回答

```yaml
type: DECISION_RESULT
payload:
  decision_id: string
  chosen_option: string
  rationale: string              # 選択の理由
  additional_constraints: [string] | null  # 決定に伴う追加制約
```

#### `STATUS_UPDATE` — 進捗報告

```yaml
type: STATUS_UPDATE
payload:
  task_ref: string | null
  new_status: enum               # working | blocked | completed | error
  progress_summary: string
  estimated_remaining: string | null  # 残り作業の見積もり
  blockers: [string] | null
```

#### `CONFLICT_REPORT` — 矛盾・不整合の検出報告

```yaml
type: CONFLICT_REPORT
payload:
  conflict_description: string
  conflicting_artifacts: [string]   # 矛盾している成果物の参照ID
  conflicting_decisions: [string] | null
  suggested_resolution: string | null
  severity: enum                    # critical | warning | info
expected_response_type: DECISION_RESULT | TASK_HANDOFF
```

#### `KNOWLEDGE_SHARE` — 情報共有

```yaml
type: KNOWLEDGE_SHARE
payload:
  topic: string
  content: string                # 共有する情報の本文
  relevance_to_recipients: string  # なぜ受け手に関係があるかの説明
  actionable: bool               # 受け手に何かアクションが必要か
  action_suggestion: string | null
```

#### `REVIEW_REQUEST` / `REVIEW_RESULT` — レビュー依頼と結果

```yaml
# 依頼
type: REVIEW_REQUEST
payload:
  artifact_ref: string
  review_focus: [string]         # レビュー観点（例: ["設計仕様との整合性", "エッジケース"]）
  blocking: bool                 # trueなら送信者はレビュー完了まで待機
expected_response_type: REVIEW_RESULT

# 結果
type: REVIEW_RESULT
payload:
  artifact_ref: string
  verdict: enum                  # approved | changes_requested | rejected
  findings:
    - severity: enum             # critical | major | minor | suggestion
      location: string           # 問題箇所の特定
      description: string
      suggested_fix: string | null
  summary: string
```

### 自然言語フォールバック

型付きメッセージで表現しきれない内容がある場合、以下のラッパーで既存のチャット機能を使う:

```yaml
type: FREEFORM
payload:
  intent_hint: string            # 最も近いメッセージ型（例: "KNOWLEDGE_SHAREに近い"）
  body: string                   # 自然言語のメッセージ本文
  requires_response: bool
  urgency: enum                  # blocking | high | normal | low
```

---

## 3. Context Budget Manager（コンテキスト予算管理）

### 目的

各Agentのコンテキストウィンドウは有限。**何を渡し、何を渡さないかをインテリジェントに制御**し、情報の過不足を防ぐ。

### 情報分類と配信ルール

```yaml
context_delivery:
  tiers:
    - tier: critical
      description: "このAgentの作業を直接ブロックしている情報"
      delivery: full_content      # 全文を渡す
      examples:
        - "待っていた依存タスクの完了報告"
        - "自分宛のDECISION_REQUEST"
        - "自分の成果物に対するREVIEW_RESULT"

    - tier: relevant
      description: "現在のタスクに関連するが、即座に必要ではない情報"
      delivery: structured_summary  # 構造化された要約を渡す
      format: |
        [要約] {agent} が {action} を実施。
        [影響] あなたのタスクへの影響: {impact_assessment}
        [詳細が必要なら] メッセージID: {msg_id} を参照要求してください。
      examples:
        - "隣接モジュールの設計変更"
        - "チーム全体への STATUS_UPDATE"

    - tier: background
      description: "一般的なプロジェクト文脈。今のタスクに直接影響しない"
      delivery: one_line_digest    # 1行ダイジェスト
      format: "[{timestamp}] {agent}: {one_line_summary}"
      examples:
        - "他チームからの KNOWLEDGE_SHARE"
        - "自分が関わらない DECISION の解決"

    - tier: irrelevant
      description: "現在のタスクに無関係"
      delivery: omit               # 渡さない
```

### 配信判定ロジック

各メッセージがAgentに届く際、以下の基準で分類する:

```
1. メッセージの `to` に自分が含まれている & priority=blocking → critical
2. メッセージの `to` に自分が含まれている → relevant 以上
3. メッセージがグループ全体宛 & 自分の current_task と関連するキーワード一致 → relevant
4. メッセージがグループ全体宛 & 関連薄い → background
5. 自分に全く関係ない → irrelevant (omit)
```

### コンテキスト構築テンプレート

各Agentのターン開始時に渡すコンテキストの構成:

```
=== あなたの現在の状態 ===
{Shared State Board から自分のagentエントリを抽出}

=== 未処理の受信メッセージ (critical) ===
{全文}

=== 最近の変更 (relevant) ===
{構造化要約のリスト}

=== バックグラウンド (直近N件) ===
{1行ダイジェストのリスト}

=== プロジェクト全体の現在の状態 ===
{Shared State Board のスナップショット（自分の担当に関連する部分を強調）}
```

---

## 4. Contract-Based Delegation（契約ベースタスク委譲）

### 目的

「よろしく」のような曖昧な委譲ではなく、**入力・出力・成功条件・権限範囲を明示した契約としてタスクを渡す**。これにより各Agentが自律的かつ安全に動作できる。

### タスク契約スキーマ

```yaml
task_contract:
  id: string
  delegator: string              # 委譲するAgent ID
  assignee: string               # 受けるAgent ID
  created_at: ISO8601

  # --- 入力定義 ---
  inputs:
    description: string          # タスクの説明
    artifacts: [string]          # 入力成果物の参照ID
    constraints:                 # 守るべき制約
      - constraint: string
        hard: bool               # true=絶対遵守, false=可能な限り
    assumptions: [string]        # 前提条件（これが崩れたら報告が必要）

  # --- 出力定義 ---
  expected_output:
    format: string               # 成果物の形式
    schema: string | null        # 出力のスキーマ（ある場合）
    deliverables: [string]       # 具体的な成果物リスト

  # --- 成功条件 ---
  acceptance_criteria:
    - criterion: string
      verification_method: string  # どうやって確認するか

  # --- 権限範囲 ---
  authority:
    autonomous_decisions: [string]   # 自律判断してよい事項
    must_consult: [string]           # 判断前に相談が必要な事項
    escalation_triggers: [string]    # この条件に該当したら即座に報告

  # --- 失敗時の振る舞い ---
  failure_handling:
    on_blocked: string               # ブロックされた場合の行動指示
    on_partial_completion: string     # 部分的にしか完了できない場合
    on_assumption_violation: string   # 前提条件が崩れた場合
    max_retries: int | null          # リトライ上限

  # --- タイムアウト ---
  timeout:
    max_steps: int | null            # 最大ステップ数
    on_timeout: string               # タイムアウト時の行動指示
```

### 使用例

```yaml
task_contract:
  id: "TC-007"
  delegator: "agent-architect"
  assignee: "agent-backend"
  
  inputs:
    description: "ユーザー認証APIの実装"
    artifacts: ["auth-api-spec-v2", "db-schema-v3"]
    constraints:
      - constraint: "既存の /api/v1/ エンドポイントとの後方互換性を維持"
        hard: true
      - constraint: "レスポンスタイム200ms以内"
        hard: false
    assumptions:
      - "PostgreSQL 15を使用"
      - "JWTベースの認証（DECISION D-012で決定済み）"

  expected_output:
    format: "TypeScript + テストファイル"
    deliverables:
      - "src/auth/ 配下の実装ファイル一式"
      - "tests/auth/ 配下のテストファイル一式"
      - "API動作確認レポート"

  acceptance_criteria:
    - criterion: "全テストがパスする"
      verification_method: "npm test 実行"
    - criterion: "API仕様書の全エンドポイントが実装されている"
      verification_method: "仕様書とのエンドポイント突合チェック"

  authority:
    autonomous_decisions:
      - "内部の関数分割やファイル構成"
      - "エラーハンドリングの具体的な実装方法"
    must_consult:
      - "API仕様に記載のないエッジケースの振る舞い"
      - "新しい外部ライブラリの導入"
    escalation_triggers:
      - "DB スキーマの変更が必要になった場合"
      - "仕様の矛盾を発見した場合"

  failure_handling:
    on_blocked: "CONFLICT_REPORTを送信し、ブロック要因を明記して待機"
    on_partial_completion: "完了部分をTASK_RESULTで報告し、残りをdeviationsに記載"
    on_assumption_violation: "即座にSTATUS_UPDATEで報告し、作業を中断"
    max_retries: 2

  timeout:
    max_steps: 50
    on_timeout: "現在の進捗をTASK_RESULTとして報告（status: partial）"
```

---

## 5. Event-Driven Reactive Dispatch（イベント駆動リアクティブ連携）

### 目的

メンションや手動通知に頼らず、**ステート変化を自動検知し、関係するAgentに適切な形式で配信する**。

### イベント定義

```yaml
events:
  # --- タスク系 ---
  - event: task_completed
    trigger: "Agentのステータスがcompletedになった"
    auto_actions:
      - notify_blocked_agents:
          filter: "blocked_by が完了したAgentのタスクを参照しているAgent"
          message_type: STATUS_UPDATE
          priority: blocking
          content_template: |
            待機中だった依存タスクが完了しました。
            完了タスク: {completed_task}
            成果物: {artifact_refs}
            → Shared State Board を確認し、作業を再開してください。
      - update_state_board:
          set: "affected_agents[].status = idle"
          clear: "affected_agents[].blocked_by"

  - event: task_blocked
    trigger: "Agentのステータスがblockedになった"
    auto_actions:
      - notify_blocking_source:
          message_type: KNOWLEDGE_SHARE
          priority: high
          content_template: |
            {blocked_agent} があなたの {dependency} を待ってブロックされています。
      - update_state_board:
          add_blocker: true

  # --- 意思決定系 ---
  - event: decision_resolved
    trigger: "pending_decisionsのstatusがresolvedになった"
    auto_actions:
      - notify_affected_agents:
          filter: "その決定に関連するタスクを持つAgent"
          message_type: KNOWLEDGE_SHARE
          priority: high
          content_template: |
            意思決定 {decision_id} が解決しました。
            決定内容: {resolution}
            あなたのタスクへの影響: {impact_assessment}

  # --- 矛盾検出系 ---
  - event: conflict_detected
    trigger: "CONFLICT_REPORTが送信された"
    auto_actions:
      - escalate_to_relevant_agents:
          filter: "conflicting_artifactsのオーナーAgent"
          message_type: CONFLICT_REPORT  # そのまま転送
          priority: high
      - pause_related_tasks:
          condition: "severity == critical"
          action: "関連Agentのステータスをblockedに設定"

  # --- 成果物更新系 ---
  - event: artifact_updated
    trigger: "成果物の新バージョンが登録された"
    auto_actions:
      - notify_dependents:
          filter: "その成果物をinputとして参照しているタスク契約を持つAgent"
          message_type: KNOWLEDGE_SHARE
          priority: normal
          content_template: |
            依存している成果物 {artifact_ref} が v{old_version} → v{new_version} に更新されました。
            変更要約: {change_summary}
            対応が必要か確認してください。
```

### イベント処理のフロー

```
[状態変化の検知]
      ↓
[イベントルールの照合]
      ↓
[該当するルールのauto_actionsを実行]
      ├── メッセージ生成 → Context Budget Managerで分類 → 対象Agentに配信
      ├── Shared State Board 自動更新
      └── 条件付きアクション（タスク一時停止など）
```

---

## 6. 統合アーキテクチャ

### レイヤー構成

```
┌─────────────────────────────────────────────────────┐
│                   Human Oversight UI                │  ← 人間の監視・介入用
│              （Slack風のビューで可視化）                │
├─────────────────────────────────────────────────────┤
│              Context Budget Manager                 │  ← 情報のフィルタリング・配信
├─────────────────────────────────────────────────────┤
│           Event-Driven Reactive Dispatch             │  ← 状態変化の自動通知
├─────────────────────────────────────────────────────┤
│            Typed Message Protocol                    │  ← 構造化されたAgent間通信
├─────────────────────────────────────────────────────┤
│    Shared State Board    │   Task Contract Store     │  ← 状態と契約の永続化
├─────────────────────────────────────────────────────┤
│          既存の基盤レイヤー（実装済み）                  │
│  グループチャット ・ メンション割り込み ・ Agent間メッセージ │
└─────────────────────────────────────────────────────┘
```

### 各Agentのターンにおけるライフサイクル

```
1. [コンテキスト受信]
   Context Budget Manager が構築した、自分用のコンテキストを受け取る
   - 未処理メッセージ（critical → relevant → background の順）
   - Shared State Board のスナップショット
   - 自分のタスク契約

2. [状況把握]
   - 自分のステータスと担当タスクを確認
   - 未処理のblockingメッセージに対応（DECISION_RESULT返答など）
   - Shared State Board の changelog で前回以降の変化を把握

3. [タスク実行]
   - タスク契約に基づいて作業を実行
   - authority.autonomous_decisions の範囲内で自律判断
   - authority.must_consult に該当する判断が必要なら DECISION_REQUEST を送信
   - escalation_triggers に該当したら即座に報告

4. [結果報告・ステート更新]
   - TASK_RESULT / STATUS_UPDATE を型付きメッセージで送信
   - Shared State Board を更新（自分のステータス、成果物、changelog）
   - 必要に応じて TASK_HANDOFF で次のAgentに委譲

5. [イベント発火]
   - ステート変化に基づいて Event-Driven Dispatch が自動で
     関連Agentへの通知・ステート更新を実行
```

---

## 7. 実装ガイドライン

### 既存機能との統合方針

| 既存機能 | 統合方法 |
|---|---|
| グループチャット | FREEFORMメッセージの配信チャネルとして使用。人間向けUIでの表示にも利用 |
| メンション割り込み | critical優先度メッセージの即座配信トリガーとして接続 |
| Agent間メッセージ | 型付きメッセージのトランスポート層として使用。ペイロードとしてTyped Message Protocolのメッセージを載せる |

### 段階的導入の推奨順序

```
Phase 1: Shared State Board
  → 最小限のスキーマでステートボードを導入
  → 各AgentにRead-on-Entry / Write-on-Exitルールを適用
  → これだけで情報の整合性が大幅に改善する

Phase 2: Typed Message Protocol
  → まず TASK_HANDOFF / TASK_RESULT / STATUS_UPDATE の3型から開始
  → 対応できないケースは FREEFORM でカバー
  → FREEFORMの使用率を観察し、新しいメッセージ型の追加要否を判断

Phase 3: Contract-Based Delegation
  → TASK_HANDOFF に task_contract を添付するルールを導入
  → 最初は簡易版（inputs, expected_output, acceptance_criteria のみ）でよい
  → authority と failure_handling は運用で問題が出てから追加

Phase 4: Event-Driven Dispatch
  → task_completed → blocked解除 のイベントチェーンから開始
  → 運用しながらイベントルールを追加

Phase 5: Context Budget Manager
  → 最も複雑なレイヤー。Agent数やメッセージ量が増えてから導入
  → 最初はシンプルなルールベース（to宛先ベースの分類）から開始
  → 必要に応じてキーワードマッチや依存関係ベースの分類に拡張
```

### 設計原則のまとめ

```
1. 構造 > 曖昧さ
   → AIは明示的な構造があるほど正確に動く

2. 現在の状態 > 過去のログ
   → コンテキストウィンドウは有限。常に最新の状態を渡す

3. 契約 > 信頼
   → 期待値を明示することで自律性と安全性を両立

4. 自動配信 > 手動通知
   → イベント駆動で確実に情報が届く仕組みにする

5. 予算管理 > 全量共有
   → 全部渡すのではなく、必要な情報を必要な粒度で渡す
```
