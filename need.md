DGrid Rankings 資料來源與統一 API 後端交接
更新日期：2026-10-20。適用頁面：/rankings 與 /rankings/community。接收對象：後端開發、資料工程、前端開發及測試。
首版目標是把現有資料的同步、模型對應、版本保存與讀取入口移至 DGrid 後端，前端保留目前版面與互動。統一 API 不等於統一評分：LiveBench 客觀成績、Arena 偏好分與未來 DGrid 自有評測必須保留各自來源及統計口徑。
1 首版範圍與現有狀態

項目
目前狀態
後端本次工作
DGrid 正式模型目錄
前端即時讀取並對應來源模型
提供權威模型、可用性及價格快照；把模型對應移至後端
LiveBench 2.0
同步腳本產生本地正式 JSON
排程同步、原始資料保存、標準化與版本發布
HF Arena
同步 text_style_control 子集的最新資料與歷史
固定 revision 匯入、保留原榜名次及區間、發布最新與歷史 API
OpenRouter
尚未接入目前頁面的資料流程
後續選用，不阻擋首版遷移
DGrid 人工／Agent 評測
已有前端解析與顯示能力，正式快照目前為空
後續發布真實結果，不要求首版補假資料
統一 Rankings API
尚未實作
首版完成 manifest、objective、preferences、preference-history

目前提交快照的基準如下，僅描述倉庫內容，不代表上游最新版本：

資料
版本與收集範圍
LiveBench
generation=2、release=2026-10-14，49 個來源評測設定、7 個能力分類；抓取時間為 2026-10-20T07:53:14.866Z
HF Arena
publishedAt=2026-10-15，30 個已對應市場模型、848 筆情境觀測、847 筆 overall 歷史；抓取時間為 2026-10-19T08:31:32.050Z
HF revision
a64ca3b12b6e6fcb9e7747cd56131d8a8047d822
HF 已收集歷史
2026-04-20 至 2026-10-15 的實際發布觀測，非每日連續資料
DGrid 自有評測
public/data/model-rankings.json 為未發布空快照

主榜顯示數量取決於來源設定與 DGrid 當前支援目錄的交集，不能把 49、30 或之前看到的 33 寫成固定可用模型數。客觀榜與偏好榜各自對應 DGrid，不要求模型同時存在於兩個外部來源。

2 現有資料來源與匯入方式

2.1 DGrid 模型市場

頁面對外入口為 DGrid 模型市場。目前 Rankings 實際使用的正式目錄端點為：

    GET https://api.dgrid.ai/api/v1/model-router/v2/models?page=1&size=100&status=enabled

以正式模型資料庫或此目錄作為可用性與報價的唯一依據，不改用測試環境、OpenRouter 目錄或舊的相似端點。現有前端不附帶 API key。

目前原始回應結構：

type CatalogResponse = {
  code: 200;
  data: {
    items: Array<{
      id: string;
      name: string;             // 市場 slug，不能當成展示名稱
      displayName?: string;
      display_name?: string;
      provider: string;
      status: string;
      icon?: string;
      priceInput?: number | string;
      priceOutput?: number | string;
      inputPrice?: number | string;
      outputPrice?: number | string;
      contextWindow?: number;
      providerCount?: number;
      pricingMode?: string;
      pricing_mode?: string;
      inputModalities?: string[];
      outputModalities?: string[];
    }>;
    total: number;
  };
};

原始欄位的相容處理見 [catalog.ts](../src/features/rankings/catalog.ts)。後端需完整讀取所有頁，檢查 total、去重與版本一致性；不要照搬目前 Arena 同步腳本最多五頁的防護上限後仍把部分結果當全量。內部有正式模型資料庫時，優先用一致性查詢或目錄版本，避免分頁期間模型變動。

價格、名稱、Logo、上下文與供應商數來自 DGrid。模型 slug 用於 /models/<provider>/<model> 及 /chat?models=<encoded-slug>，不可從第三方展示名稱直接拼接路由。

2.2 LiveBench 客觀評測

官方入口：LiveBench。目前有效版本的檔案位置：

    https://livebench.ai/data/20261014/table.csv
    https://livebench.ai/data/20261014/categories.json
    https://livebench.ai/data/20261014/breakdown.json
    https://livebench.ai/data/20261014/cost.csv
    https://livebench.ai/data/20261014/notes.json

現有流程見 [sync-benchmarks.mjs](../scripts/sync-benchmarks.mjs)、[livebench-metadata.mjs](../scripts/livebench-metadata.mjs) 與 [benchmark-data.mjs](../scripts/benchmark-data.mjs)：

1. 讀取官網及目前 JavaScript asset，透過 AST 取得字面量 release 與模型 metadata；不執行下載的 JavaScript。
2. 使用同一 release 路徑取得 table、categories、breakdown、notes 及可選 cost。
3. 保留精確模型設定、推理強度、分類與細項；驗證分數範圍和模型 metadata。
4. 產生內容定址 JSON，成功後才原子更新 index.json。失敗保留上一版本，不降版。
5. cost 只有明確 404 才按缺少處理；逾時、429、500 等不能假裝成沒有資料。
  
categories、scores、breakdown 與 metadata 都有版本關係。不得把舊版本的欄位補進新版本；上游結構改變時停止發布並通知維護人員，不繼續按舊欄位猜測。

前端讀取：

    /data/benchmarks/index.json
    /data/benchmarks/<release>-<content-hash>.json

目前來源 model 資料尚未附加 market；瀏覽器透過 joinCatalog 對應目錄。統一 API 後此對應由後端完成。

2.3 HF Arena 偏好與歷史

官方入口：lmarena-ai/leaderboard-dataset。目前只使用 text_style_control，latest 提供最新情境資料，full 提供已發布歷史；不是抓取 Arena 網頁 HTML。

現有流程見 [sync-arena-evidence.mjs](../scripts/sync-arena-evidence.mjs)：

    GET https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset
    GET https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset/tree/<revision>/text_style_control
    GET https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/<revision>/<file-path>?download=true

先取得 repository SHA，所有 latest 與 full Parquet 檔都固定讀取同一 SHA。下載並解析所有相關分片，不能一半來自新 revision、一半來自舊 revision。

HF 原始欄位
目前前端欄位
語意
model_name
model／sourceModel
來源的具體模型設定名稱
organization
organization
來源組織名稱
leaderboard_publish_date
date
上游發布日期，不是 DGrid 抓取時間
rating
score
原始偏好分，不是正確率
rating_lower、rating_upper
lower、upper
來源分數區間
vote_count
votes
此模型的來源票數，不能直接跨模型相加當不重複對戰數
rank
rank
來源情境榜名次，不是頁面篩選後的序號
category
category
來源情境鍵

目前匯入工具按 overall 原榜排序，對應 DGrid 後最多選 30 個市場模型；同一市場模型優先選無強度後綴的來源設定，否則保留原本帶強度名稱。full 目前只取這批設定約 180 天的 overall 歷史。

後端建議保存完整原始檔與可承受範圍的全量正規化結果，再決定 API 展示池；不要只保存前十筆，導致新增支援模型時無歷史可用。保留來源原始設定，不能把 High 與 Max 的歷史拼成同一條曲線。

目前前端讀取 /data/arena-evidence.json；授權標記為 CC-BY-4.0。HF 的 Agent 子集使用不同於文字偏好榜的指標，若未來啟用，必須另外定義尺度與樣本欄位，不能直接塞入目前 rating／votes 格式。以資料集 schema為準。

2.4 OpenRouter 與 DGrid 自有資料

OpenRouter 目前不是主榜或社群區的資料依賴。若後續啟用，從 Benchmarks 文件建立獨立 adapter，保存 source、benchmark_type、model_permaslug、版本、日期與原始尺度。供應不同形狀的資料時按來源分型，不能用另一來源的 coding_index 補成 LiveBench Coding 成績，也不能把 accuracy_stddev 當作信賴區間。

DGrid 自有評測保留獨立來源及協議，沒有正式資料可以先不開發公開榜單。DGrid 的使用量、延遲、成功率、可用性與實際對戰紀錄不能由外部榜單補出，首版不要求開發這些新板塊。

3 各頁面需要的資料

板塊
必要資料
前端保留的計算與展示
模型排行榜
同版本評測設定、綜合分、分類與細項、market
搜尋、排序、欄位、設定展開、篩選及 CSV
效能與成本分析
能力分、目前 DGrid 價格與計費模式
散點圖、成本排序、成本效益前緣與比較高亮
能力概況
分類分數、評測設定與 market
最多三個模型的雷達圖及數值表
分類強項榜
同模型池的分類成績
每個分類取前三名
預算選型
分數、價格、計費模式、上下文
token 與呼叫次數估算，取前五名
評測輸出用量
綜合分、同版本平均輸出 token、目前輸出單價
最低分門檻與前十筆用量排序
社群偏好榜
同情境偏好分、區間、票數、原榜名次、發布日期
情境切換、區間圖、展開證據
情境偏好地圖
模型與情境交叉觀測
前十模型、最多六情境、分數／名次／樣本切換
榜單動態
真實發布節點的 overall 名次、分數、區間與票數
期間、變動篩選、迷你圖、最多三模型對照與 CSV

客觀主表的搜尋／組織／開放權重等篩選只影響主表，不能讓其他圖表跟著丟失模型。主表先顯示十筆、每次展開十筆；這是前端展示分批，不是後端只回傳十筆。首版 API 回傳完整且有範圍上限的資料池，不需為每張圖各開一支端點。

4 模型識別與分數規則

4.1 模型對應

必須分開保存：

欄位
定義
modelId
DGrid 內部穩定模型 ID
modelSlug
正式市場與 Chat 使用的 slug
evaluationId
同來源下模型版本與推理設定的穩定 ID
sourceModelId／sourceName
上游 ID／原始名稱
resultId
某 evaluationId 在特定來源版本、情境及日期下的結果 ID

evaluationId 不隨每次抓取時間改變；Arena 同一設定跨發布日期必須保持相同 ID，否則歷史會斷裂。不同 High／Max 或不同日期版模型不能共用 evaluationId；只有 resultId 包含觀測日期或 release。

建立對應表並保存 matchMethod、reviewStatus、reviewedAt。精確 ID 或已審核別名優先；版本、Preview、Pro、Mini、Code、來源組織與日期版有歧義時不自動發布，進入待審核清單。當前前端的日期／強度正規化可作相容參考，不代表後端應任意去掉所有版本後綴。

客觀榜預設取同一市場模型的最高綜合分設定，Arena 目前優先無強度後綴設定，兩者不採同一「最高分」猜配規則。後端回傳 defaultEvaluationId 或等效旗標以明確化選擇；其他可用客觀設定仍須保留，支援「全部設定版本」。

所有公開展示模型需在該 catalogAsOf 目錄中為 enabled 且符合文字模型範圍。保留 evaluationConfig，不宣稱 DGrid 的預設呼叫設定能完全重現外部評測成績。模型下架後重建最新公開資料池；實際 Chat／API 呼叫端仍需即時檢查可用性。

4.2 分數與成本

- LiveBench 2.0 分類成績直接使用來源公布值。綜合分沿用目前算法：對已有分類成績等權重平均、四捨五入至兩位小數。保存 aggregationMethod=mean_available_suites，表明其計算方式。
- 單一分類顯示其來源細項；選取多分類時，只有所選分類均有成績才計算等權重平均。不要用 breakdown 子類無權重平均重建來源分類成績。
- 缺少成績／價格回傳 null；真實零分／免費價格回傳 0。數值不得包美元符號、百分號、逗號或 NaN。
- 客觀分數範圍是 0–100；Arena 偏好分保留來源尺度，不轉成百分比或正確率。信賴區間不等於名次區間。
- LiveBench 1.0 存檔不與 2.0 混算，也不拿跨題集總分計算能力提升。
  
估算使用 DGrid USD／百萬 token 單價：

    每次成本 = (輸入 token × 輸入單價 + 輸出 token × 輸出單價) / 1,000,000
    預估總費用 = 每次成本 × 呼叫次數

成本圖預設為 1,000 輸入加 1,000 輸出 token；預算選型用訪客輸入。只對 by_usage 且價格齊全的模型估算，免費價格保留；零成本不進對數軸。價格不除以評測分數。保留 pricingPolicy，說明市場報價策略，不默默改成某供應商最低價。後端以 Decimal 保存與處理金額；公開數值供前端預覽，實際帳單依計費服務。

known contextWindow 不足以容納輸入加輸出時，排除該預算方案；上下文不明不能被標成已驗證可容納。估算不含快取折扣、額外推理 token 或階梯計費。評測平均輸出 token 是 evaluation_task 的用量，不是延遲、吞吐或單次回答長度。

4.3 歷史與樣本

以來源 publishedAt 為期間終點，不以今天重新抓取時間假裝新評測。近一月／三月以來源終點回推；日期對照只使用實際發布節點。

同一視窗至少有兩筆觀測，且模型在視窗的共同起訖發布節點皆有資料，才計算：

    rankChange = first.sourceRank - last.sourceRank
    scoreChange = last.score - first.score

正 rankChange 表示排名上升。晚進榜、單點或缺少端點回傳 null。缺少日期不補值；來源協議有不相容改版時分段，不跨改版計算變化。「首次出現」只代表已收集歷史內首次觀測，不等於模型上市。

5 建議的統一 API 契約

本節是新契約草案，需前後端確認 OpenAPI 後實作，不能直接套用到目前 parser。統一回應外層使用 code／data／meta；既有 schemaVersion=1 指的是舊快照格式，新的 API schemaVersion 獨立管理。

5.1 端點

優先級
方法與路徑
data
P0
GET /api/v1/rankings/manifest
當前 snapshotId、catalogVersion、各資料集狀態／版本與讀取路徑
P0
GET /api/v1/rankings/objective?snapshot=<id>
一個 LiveBench release 的分類、完整已對應評測設定、輸出用量與 market
P0
GET /api/v1/rankings/preferences?snapshot=<id>
最新 Arena 情境觀測、模型設定與 market
P0
GET /api/v1/rankings/preference-history?snapshot=<id>
同一設定的已收集真實歷史與資料涵蓋範圍
P1
GET /api/v1/rankings/community?snapshot=<id>
未來 DGrid 自有人工／Agent 已發布結果

snapshot 為不透明 ID，不由前端組合或猜測。前端先讀 manifest，再帶相同 snapshot 讀各資料集；所有 market 資訊都基於同一 catalogVersion，不得某端點臨時抓最新目錄、另一端點仍用舊價格。snapshot 發布後內容不覆寫，最新 manifest 可前進；資料來源日期不同是允許的，但必須個別標示。

來源失敗或目錄有效性狀態改變時，可發布新的 bundle 並引用原有成功資料集，將新 bundle 標為 stale；不覆寫舊 snapshot 的 metadata。資料 hash 未改變與來源狀態改變需分開判斷。

preferences 與 preference-history 回傳各自所需的模型 registry／market，獨立社群頁不必先載入 LiveBench。首版 history 不強制服務端分頁，回傳已公告的完整歷史範圍；可選 from、to 為含起訖的 YYYY-MM-DD，from 大於 to 回傳 400，資料為空回傳空觀測。限制日期跨度、資料量與參數長度，不能靜默截斷。

5.2 共用外層與 metadata

type SourceMeta = {
  id: string;                        // livebench、hf-arena、dgrid
  protocolId: string;                // 指標、協議與解析口徑版本
  release: string | null;
  revision: string | null;
  sourcePublishedAt: string | null;  // 來源有時間才填，不能以抓取時間補造
  fetchedAt: string;                 // 上一次成功抓取，ISO 8601 UTC
  sourceUrl: string;
  license: string | null;
};

type RankingsResponse<T> = {
  code: number;                      // 與 HTTP status 一致
  data: T | null;
  meta: {
    schemaVersion: '1.0';
    snapshotId: string | null;
    generatedAt: string;
    catalogVersion: string | null;
    catalogAsOf: string | null;
    catalogValidUntil: string | null; // 依後端目錄有效期限配置計算
    datasetVersion: string | null;
    status: 'ready' | 'stale' | 'empty' | 'unavailable';
    sources: SourceMeta[];
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

manifest 的 data.datasets 按 objective／preferences／preferenceHistory／community 列出 status、datasetVersion、href 與可用日期範圍；未開通的 P1 用 unavailable，不假裝有已發布結果。日期範圍來自觀測，不是名義上的「180 天一定每天有值」。

sourcePublishedAt、fetchedAt、generatedAt 與 catalogAsOf 分開。首次沒有任何成功資料時，sources 可為空，data=null；不要為了滿足型別捏造來源時間。狀態與來源 metadata 均描述該發布快照，持續同步的最近嘗試／失敗原因另保存在內部任務紀錄。

5.3 模型與客觀資料

以下為建議資料形狀；OpenAPI 必須補齊所有必填、null、枚舉及唯一性約束：

type MarketModel = {
  id: string;                       // DGrid modelId
  slug: string;
  name: string;
  provider: string;
  icon: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
  currency: 'USD';
  priceUnit: 'per_million_tokens';
  pricingMode: string;
  pricingPolicy: string;
  pricingAsOf: string;
  contextWindow: number | null;
  providerCount: number | null;
  inputModalities: string[];
  outputModalities: string[];
  status: 'enabled';
};

type EvaluationModel = {
  evaluationId: string;
  sourceModelId: string;
  sourceName: string;
  evaluationConfig: string | null;
  market: MarketModel;
};

type ObjectiveModel = EvaluationModel & {
  baseId: string;
  openWeights: boolean;
  reasoning: boolean;
  finetune: boolean;
  overall: number | null;
  incomplete: boolean;
  categories: Record<string, number | null>;
  tasks: Record<string, number | null>;
  categoryDetails: Record<string, Record<string, number | null>>;
  benchmarkUsage: {
    avgOutputTokens: number | null;
    basis: 'evaluation_task';
  };
};

type ObjectiveData = {
  sourceId: 'livebench';
  release: string;
  generation: 2;
  aggregationMethod: 'mean_available_suites';
  scoreScale: { min: 0; max: 100 };
  categories: Record<string, string[]>;
  models: ObjectiveModel[];
  defaultEvaluationBySlug: Record<string, string>;
};

API 必須回傳所有符合公開範圍的可用設定，不能只回最高十名；defaultEvaluationBySlug 決定預設設定，「全部設定版本」仍使用 models 的完整集合。分類鍵沿用來源 Long Agentic、Reasoning、Coding、Browser、Data Analysis、Research、Design，不用翻譯後的文字當新 ID。各分類細項不完整時保留 null。

若價格在目前計價模式下無法用 USD／百萬 token 比較，inputPrice／outputPrice 回傳 null；不能把按次價格塞進這兩個欄位。source 歷史執行成本需要稽核時另保存，不用它覆蓋 market。

5.4 最新偏好與歷史

type PreferenceObservation = {
  evaluationId: string;
  sourceModelName: string;
  category: string;
  date: string;                     // YYYY-MM-DD
  score: number;
  lower: number;
  upper: number;
  votes: number;
  sourceRank: number;
};

type PreferencesData = {
  sourceId: 'hf-arena';
  subset: 'text_style_control';
  protocolId: string;
  confidenceLevel: 0.95;
  publishedAt: string;
  categories: string[];
  models: EvaluationModel[];
  ratings: PreferenceObservation[];
};

type PreferenceHistoryData = {
  sourceId: 'hf-arena';
  subset: 'text_style_control';
  protocolId: string;
  models: EvaluationModel[];
  coverage: {
    from: string | null;
    to: string | null;
    scope: 'available_observations';
  };
  observations: PreferenceObservation[]; // 首版只回 overall
};

ratings 內日期必須符合該批 publishedAt；來源各情境發布日期不同時，不偷換日期來湊同批，應採完整發布批次或明確擴充契約後才發布。評測設定／情境／日期唯一，lower ≤ score ≤ upper；票數與原榜名次為正整數。

confidenceLevel=0.95 是目前 UI 的展示要求；後端需核對來源協議確實相符。來源區間口徑不同時必須調整契約與顯示，不能只改欄位名稱就宣稱是 95% 區間。

history 按日期與 evaluationId 穩定排序。缺少觀測就沒有該列，不補零、不 forward-fill。models 與 observations 的 ID 必須可對應；涵蓋範圍由實際可取得資料決定。數十筆模型的票數不能相加當總對戰數，前端左側顯示序號也不能覆蓋 sourceRank。

5.5 HTTP 與快取

情況
HTTP
回應
正常快照
200
data 正常，meta.status=ready
上游暫時失敗但有可用舊資料
200
data 保留，meta.status=stale，來源時間不改成現在
合法條件沒有觀測／已驗證模型交集為空
200
data 的集合為空，meta.status=empty
參數不合法
400
error.code=INVALID_ARGUMENT
snapshot 不存在
404
error.code=SNAPSHOT_NOT_FOUND
已超過承諾保留期而移除的 snapshot
410
error.code=SNAPSHOT_EXPIRED，前端重新讀 manifest
沒有任何可用成功快照
503
data=null、meta.status=unavailable，提供 retryable
公開端點限流
429
error 與 Retry-After

後端以 ETag 支援條件請求；manifest 的快取時間先採 60 秒、CDN 300 秒作為建議初值。帶 snapshot 的成功資料可用長快取，但只有在內容與所述狀態均不再覆寫時才加 immutable；錯誤回應不要長期快取。公開快照保留期至少涵蓋 CDN 快取與合理開頁工作階段，過期明確回 410。

stale 不代表價格仍可直接計費。目錄超過另行設定的有效期限後，不得宣稱模型為即時已驗證可用；前端需呈現資料時間，必要時停止成本估算／直接試用入口，實際模型調用端再驗證當前狀態。上游評測來源失敗不應清空其他正常板塊。

5.6 錯誤回應與請求順序範例

以下是尚無可用快照時的新契約範例，不是已部署 API 的實際回應。generatedAt 為示例時間，來源尚未成功抓取時 sources 保持空陣列：

{
  "code": 503,
  "data": null,
  "meta": {
    "schemaVersion": "1.0",
    "snapshotId": null,
    "generatedAt": "2026-10-20T08:00:00Z",
    "catalogVersion": null,
    "catalogAsOf": null,
    "catalogValidUntil": null,
    "datasetVersion": null,
    "status": "unavailable",
    "sources": []
  },
  "error": {
    "code": "NO_PUBLISHED_SNAPSHOT",
    "message": "尚無可用的已發布資料快照。",
    "retryable": true
  }
}

前端請求順序：

1. GET manifest，取得目前 snapshotId 與各資料集狀態。
2. 主頁以相同 snapshotId 並行讀 objective、preferences、preference-history；獨立社群頁只讀後兩者。
3. 各資料集分別處理成功、過期與錯誤，不用一個未分流錯誤的 Promise.all 讓單一來源故障清空整頁。
4. 版本過期回 410 時重新讀 manifest，重新載入該版本需要的整組資料；不混入上一 snapshot 的市場資訊。
  
6 後端同步與儲存實作

建議流程：

    來源 adapter
      → 原始檔保存
      → schema 與欄位校驗
      → 模型設定對應與待審核清單
      → 正規化結果
      → 同一 catalogVersion 的公開資料池
      → 驗證新快照
      → 原子切換 manifest
      → 快取／CDN

建議的儲存實體，可使用現有模型資料表及 JSONB／物件儲存，不強制特定技術棧：

實體
內容與約束
source_snapshots
來源、release、revision、原始檔路徑、hash、授權、來源發布與成功抓取時間
evaluation_configs
來源模型版本、推理設定及穩定 evaluationId
model_mappings
evaluationId 與 DGrid modelId／slug、對應方法、審核狀態、審核時間
benchmark_results
source／protocol／release／evaluationId 唯一，分類、細項、綜合分及用量
preference_observations
source／protocol／subset／evaluationId／category／date 唯一，分數、區間、票數與原榜名次
published_snapshots
snapshotId、catalogVersion、各資料集引用、發布時狀態及內容 hash
sync_job_runs
最近嘗試、成功／失敗、耗時、來源筆數、已對應數、未對應原因及錯誤摘要

可先用以下檢查頻率；這些是 DGrid 排程建議，不是來源的更新保證：

- DGrid 目錄：模型變更事件觸發，或每 5–15 分鐘。
- LiveBench 與 HF：每 6 小時檢查，版本／hash 未改變則不重複發布。
- OpenRouter：只有啟用後再排程，依帳號權限、官方限流與授權調整。
  
每個 adapter 設超時、有限重試、退避與 429 處理；使用鎖避免同來源排程重疊。hash 以實際資料／來源 revision 判斷是否改變，不能只因 fetchedAt 更新就產生無意義的新資料版本。

上游必填欄位消失、型別改變、分數越界、CI 不含點估計、重複 ID、模型數異常減少或目錄分頁不完整時，保留舊快照並告警。筆數／對應率突變門檻做成配置，不能悄悄把少量錯誤資料發布成正常全榜。

來源 URL 固定白名單，不對外開任意 URL 轉發器；API key 僅保存於後端秘密管理，不進 VITE 環境變數、前端 bundle 或公開日誌。可先匯入現有已提交 JSON 建立基線，再切換外部排程，不需要執行任何付費模型推理。

7 前端改造清單

位置
改造內容
src/pages/Rankings.tsx
改讀新 manifest／objective；不再直接讀靜態 index 與 release 檔，不再呼叫 joinCatalog
src/features/rankings/catalog.ts
Rankings 不再自行分頁拉目錄、猜配外部 ID；保留路由、格式化及必要的成本純函式
src/features/rankings/ArenaEvidence.tsx
改讀 preferences 與 preference-history，組合為元件需要的資料
src/features/rankings/arenaEvidenceData.ts
以 evaluationId／market 驗證後端明確對應，移除瀏覽器端名稱猜配
src/pages/CommunityRankings.tsx
與主頁共用讀取服務，不重複請求目錄；有正式自有結果才載入 P1 區塊
新增 rankingsApi／Types／Adapters
統一 base URL、解包 code／data／meta、執行 schema 驗證、超時與快取
狀態與 CSV
處理 ready／stale／empty／unavailable，匯出保留來源、版本、設定與目錄時間

adapter 把 ObjectiveModel.evaluationId 對應為目前元件的 model.id，name／organization 取 market，sourceName 保留原名。把 benchmarkUsage.avgOutputTokens 對應到目前成本型別中的輸出用量欄位，但不能把來源歷史價格當市場報價。

目前 parseManifest 驗證內容定址 JSON 檔名、parseRelease 要求非空 models、parseArenaEvidence 固定舊 subset／sourceUrl／license 與 models 結構；新契約不能只換 URL 就直接傳進去，empty 狀態也需新增明確分支。元件可保留，請求與驗證層要改。

目前可用 VITE_RANKINGS_CATALOG_URL、VITE_ARENA_EVIDENCE_URL、VITE_ARENA_COMMUNITY_URL／VITE_ARENA_RANKINGS_URL，只適用與舊格式完全一致的相容端點。主榜 dataRoot 仍寫在頁面內。新 API base URL 環境變數需另行新增與部署，不可宣稱現在已存在。

保留主表局部篩選、最多三個設定比較、各圖表獨立範圍及前端計算器預覽。格式顯示與翻譯仍由前端負責，中文使用 zh-TW；後端不回傳已格式化的美元字串或用翻譯文字替換穩定欄位鍵。

8 DGrid 自有評測後續契約

P1 可沿用目前 CommunitySnapshot 的資料部分，外面再包統一 API envelope；不要把 HF 快照轉進此協議後捏造缺少的 prompts／案例。

type CommunityData = {
  mode: 'published';
  protocol: string;
  updatedAt: string | null;
  source: string;
  models: Array<{
    id: string; name: string; slug: string;
    organization: string; version: string;
  }>;
  ratings: Array<{
    modelId: string;
    cohort: 'human' | 'agent';
    task: string; language: string;
    score: number; ci: [number, number];
    judgments: number; prompts: number;
  }>;
  duels: [];                         // 保留相容，已移除模型對決板塊
  cases: BlindCase[];
};

type BlindCase = {
  id: string;
  modelA: string;
  modelB: string;
  task: string;
  language: string;
  prompt: Record<string, string>;
  answerA: Record<string, string>;
  answerB: Record<string, string>;
  human: { a: number; b: number } | null;
  agent: { a: number; b: number } | null;
  publicApproved: true;
};

正式頁拒絕 mode=demo。modelId／cohort／task／language 組合唯一；judgments 與 prompts 為真實有效統計，人工與 Agent 不混算，也不用獎勵積分加權。protocol 應固定題集／語言混合、模型設定、評分、去重、發布門檻及區間計算規則。

cases 只有已授權且去識別化的題目與兩份回答才可公開。欄位含 id、modelA、modelB、task、language、prompt、answerA、answerB、human、agent、publicApproved=true；三種文字是語言鍵值物件。每組評審結果對應相同兩份回答，分布只能是 { a, b } 或 null。現有 Arena 只有 A／B 選擇，不能補平局／兩者皆差；左右互換時分布也要互換。

題目／對戰 ID、評審去重識別、用戶／錢包、IP、完整私有 prompt 與裁判 key 不得直接公開。前端案例選擇目前只留在本頁，不送票、不計獎勵。DGrid 沒有足夠資料時保持空結果，不能用外部偏好分推算自身勝率、原始案例或服務品質。

9 聯調與上線順序

1. 後端與前端確認本文件的新契約，交付 OpenAPI 與 ready、stale、empty、unavailable、錯誤範例，明確模型對應、預設設定與價格政策。
2. 匯入現有正式快照，保存來源版本及 hash；凍結同一份 DGrid 目錄作為比對基準，避免聯調時價格變動造成假差異。
3. 完成兩個外部 adapter、目錄更新、模型對應審核、原子發布及四支 P0 端點。首次接入保留原始模型池與顯示規則，不順便改評測來源。
4. 前端在測試／預發布環境以新 adapter 替換資料層，兩條頁面路由都測；只有比較時使用凍結目錄，正式仍發布新目錄版本。
5. 用同一來源 release／revision 與 catalogVersion，比對模型集合、預設設定、成績、價格、原榜名次、區間、歷史及 CSV。
6. 灰度切換正式流量，監控錯誤率、最後成功同步時間、對應率與快照版本；保留部署設定回滾舊入口。
7. 穩定且回滾方案確認後，才停止前端靜態快照發布。後端遷移尚未完成前，不能刪掉 public/data、同步腳本或 hyparquet 依賴。
  
來源 metadata 與授權保留在 API／來源說明中，不需在每張卡片重複展示；使用 DGrid 域名不會改變來源權利，也不能將外部成績稱為 DGrid 自測。HF 資料集標示 CC BY 4.0；LiveBench、OpenRouter 及其各評測來源的資料使用／轉授權條件由產品與法務在發布前確認，不能用某個程式碼倉庫的授權代替資料授權。

驗收清單

[] 四支 P0 端點、OpenAPI 與正常／錯誤回應樣例齊全；P1 可不啟用。
[] 每個公開設定對應明確 DGrid 模型，未對應／歧義模型有待審核原因。
[] 啟用或下架模型、價格變更後可發布新 catalogVersion 與 snapshot。
[] 相同 snapshot 的各資料集使用相同市場資訊，快照內容不被覆寫。
[] 分數、零價格、缺值、細項與推理設定和同版本來源一致。
[] 成本以 USD／百萬 token 計，非 by_usage 模型不硬算；已知上下文不足的方案排除。
[] HF 來源原榜名次與頁面序號分開，票數不當成跨模型不重複對戰總數。
[] 歷史不補點、不跨不相容協議混算，晚進榜／缺端點的變化為 null。
[] HF 與 LiveBench 任一來源逾時／429／結構改變時保留舊成功資料，不影響其他正常板塊。
[] 目錄過期與沒有任何可用快照可辨識，不假裝即時可用、不補假模型。
[] 前端網路請求只讀 DGrid 資料端點，不再自行解析第三方或重複猜配。
[] 正式部署不包含 tests/fixtures，公開回應及 bundle 不含憑證或私人評審紀錄。
[] 兩條路由、搜尋、展開十筆、三模型比較、預算、歷史範圍及 CSV 通過聯調。
[] 排程、內部同步狀態、異常告警、快照保留／回滾操作已交付。
  
10 現有程式與驗證入口

路徑
用途
scripts/sync-benchmarks.mjs
LiveBench 同步與發布
scripts/livebench-metadata.mjs
安全解析來源 metadata
scripts/benchmark-data.mjs
CSV、V1／V2 正規化與缺值規則
scripts/sync-arena-evidence.mjs
HF revision／Parquet 匯入與市場對應
src/features/rankings/benchmark.ts
目前客觀資料型別與 parser
src/features/rankings/catalog.ts
正式目錄格式、模型對應、計價與路由
src/features/rankings/arenaEvidenceData.ts
目前 HF 快照型別與 parser
src/features/rankings/arenaMovement.ts
歷史變化、缺口及 CSV 規則
src/features/rankings/community.ts
自有評測與 A／B 契約
public/data/benchmarks/index.json
當前 release、來源 URL、hash 與存檔索引
public/data/arena-evidence.json
本次 HF 正式快照與 revision

同步指令會抓取並更新資料，需在指定環境執行；沒有安裝自動排程，也不會呼叫付費推理：

    npm run sync:benchmarks
    npm run sync:arena

依賴安裝完成後，下列測試與前端建置不需抓取第三方資料：

    node --experimental-strip-types --test tests/*.test.mjs
    npx tsc -b
    VITE_SKIP_MODEL_SEO=1 npm run build

上述建置略過需外部模型服務的既有 SEO 預渲染；正式部署如需預渲染，仍須驗證正常建置。測試假資料僅在 tests/fixtures，不可用作正式 fallback。

首版交付重點：正式目錄、LiveBench、HF 三者的可靠整合與四支讀取 API。新增排行榜、DGrid 遙測、自有評分服務及 OpenRouter 擴充不屬於這次遷移的必做項目。