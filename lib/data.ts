import type {
  Chapter,
  Character,
  CharacterRelation,
  Novel,
  OutlineItem,
  RewriteCandidate,
  RewriteConstraint,
  RewritePreset,
  TimelineEvent,
  TrajectoryEntry,
  Volume,
  WorldEntry,
} from './types'

export const novels: Novel[] = [
  {
    id: 'novel-1',
    title: '灰烬列车',
    summary: '一辆穿越废土与梦境边界的列车，载着失忆者寻找终点。',
    tags: ['科幻', '悬疑', '公路'],
    updatedAt: '2026-05-11 17:20',
    wordCount: 48231,
    chapterCount: 12,
  },
  {
    id: 'novel-2',
    title: '海潮之下',
    summary: '沉没城市里，记忆像潮水一样被打捞。',
    tags: ['奇幻', '都市', '成长'],
    updatedAt: '2026-05-10 22:41',
    wordCount: 19220,
    chapterCount: 6,
  },
]

export const volumes: Volume[] = [
  { id: 'vol-1', novelId: 'novel-1', title: '卷一：雾海列车', order: 1 },
  { id: 'vol-2', novelId: 'novel-1', title: '卷二：遗忘车厢', order: 2 },
]

export const chapters: Chapter[] = [
  {
    id: 'ch-1',
    novelId: 'novel-1',
    volumeId: 'vol-1',
    title: '第1章 雨夜站台',
    order: 1,
    status: 'done',
    wordCount: 3210,
    updatedAt: '今天 16:41',
    content:
      '<p>站台上没有风，只有雨。列车在雾里发出低沉的鸣笛，像一头不耐烦的兽。</p><p>林砚抱着那只磨损严重的手提箱，站在黄线之后，迟迟没有上车。</p><p>她并不记得自己为什么会来到这里，只记得那张被雨水浸湿的车票，和票背后一句歪斜得像警告的话：<strong>不要进入第七码厢。</strong></p>',
    originalContent:
      '<p>站台上没有风，只有雨。列车在雾里发出低沉的鸣笛，像一头不耐烦的兽。</p><p>林砚抱着那只磨损严重的手提箱，站在黄线之后，迟迟没有上车。</p><p>她并不记得自己为什么会来到这里，只记得那张被雨水浸湿的车票，和票背后一句歪斜得像警告的话：<strong>不要进入第七码厢。</strong></p>',
    trajectory: ['建立“暴雨夜登车”母题', '保留第七码厢警告', '林砚情绪外显度偏低'],
  },
  {
    id: 'ch-2',
    novelId: 'novel-1',
    volumeId: 'vol-1',
    title: '第2章 无票乘客',
    order: 2,
    status: 'draft',
    wordCount: 2870,
    updatedAt: '今天 15:20',
    content:
      '<p>车门关闭的瞬间，她听见身后传来脚步声。有人在最后一秒跃上车厢，喘息声混着潮湿的铁锈味。</p><p>那人抬头，朝她笑了一下，笑意却像刀锋一样薄。</p><p>林砚还没有来得及开口，广播便响了起来，冷硬的女声像从铁皮深处刮过：请所有乘客回到自己的座位，列车即将离站。</p>',
    originalContent:
      '<p>车门关闭的瞬间，她听见身后传来脚步声。有人在最后一秒跃上车厢，喘息声混着潮湿的铁锈味。</p><p>那人抬头，朝她笑了一下，笑意却像刀锋一样薄。</p>',
    trajectory: ['闻舟出场要保持危险感', '广播规则第一次落地', '适合生成分支交互'],
  },
  {
    id: 'ch-3',
    novelId: 'novel-1',
    volumeId: 'vol-2',
    title: '第3章 第七码厢',
    order: 1,
    status: 'review',
    wordCount: 3512,
    updatedAt: '昨天 22:10',
    content:
      '<p>第七码厢没有编号，只有一块被划花的铜牌。她推门进去，看见所有乘客都在看着她。</p><p>空气里没有灯光，却有某种像记忆一样的微亮，在每个人的睫毛边缘颤动。</p>',
    originalContent:
      '<p>第七码厢没有编号，只有一块被划花的铜牌。她推门进去，看见所有乘客都在看着她。</p><p>空气里没有灯光，却有某种像记忆一样的微亮，在每个人的睫毛边缘颤动。</p>',
    trajectory: ['规则被违反后的后果', '群像压迫感', '适合做视角切换改写'],
  },
  {
    id: 'ch-4',
    novelId: 'novel-1',
    volumeId: 'vol-2',
    title: '第4章 回声',
    order: 2,
    status: 'draft',
    wordCount: 1894,
    updatedAt: '昨天 20:46',
    content:
      '<p>她听见自己的名字从车厢深处传来，像从很远很远的水面之下浮起。</p><p>那声音不像呼唤，更像某种已经写进命运里的回声，在她抬头之前，就先一步认出了她。</p>',
    originalContent:
      '<p>她听见自己的名字从车厢深处传来，像从很远很远的水面之下浮起。</p>',
    trajectory: ['偏内心戏', '可压缩冗余比喻', '适合续写模式'],
  },
]

export const outlines: OutlineItem[] = [
  {
    id: 'o-1',
    novelId: 'novel-1',
    title: '登上列车',
    type: 'main',
    summary: '主角在暴雨夜进入灰烬列车，意识到自己正被某种规则驱赶向前。',
    relatedChapterIds: ['ch-1', 'ch-2'],
  },
  {
    id: 'o-2',
    novelId: 'novel-1',
    title: '闻舟的真实身份',
    type: 'foreshadow',
    summary: '闻舟不是普通乘客，他对列车规则异常熟悉，且似乎认识失忆前的林砚。',
    relatedChapterIds: ['ch-2', 'ch-3'],
  },
  {
    id: 'o-3',
    novelId: 'novel-1',
    title: '进入第七码厢',
    type: 'conflict',
    summary: '主角为了寻找真相，不得不违背警告进入第七码厢，并直面自己想遗忘的过去。',
    relatedChapterIds: ['ch-3'],
  },
  {
    id: 'o-4',
    novelId: 'novel-1',
    title: '广播规则升级',
    type: 'side',
    summary: '每次广播都提高列车秩序的威胁等级，为中后段惊悚转折做铺垫。',
    relatedChapterIds: ['ch-2', 'ch-4'],
  },
]

export const characters: Character[] = [
  {
    id: 'c-1',
    novelId: 'novel-1',
    name: '林砚',
    role: '主角',
    goal: '找回失去的记忆，并弄清自己为何必须乘上这辆列车。',
    trait: '谨慎、克制、观察力强，情绪极少外露。',
    note: '随身携带旧手提箱，似乎对“第七码厢”有本能恐惧。',
  },
  {
    id: 'c-2',
    novelId: 'novel-1',
    name: '闻舟',
    role: '关键配角',
    goal: '引导林砚到达正确的终点，但动机不明。',
    trait: '从容、锋利、带一点玩世不恭。',
    note: '像是不速之客，却比所有乘客都更熟悉规则。',
  },
  {
    id: 'c-3',
    novelId: 'novel-1',
    name: '广播女声',
    role: '环境压迫源',
    goal: '维持列车秩序与叙事张力。',
    trait: '冷硬、无机质、像系统提示。',
    note: '适合作为每一章节奏切点。',
  },
]

export const worldEntries: WorldEntry[] = [
  {
    id: 'w-1',
    novelId: 'novel-1',
    title: '灰烬列车',
    type: 'item',
    content: '一辆在现实与梦境之间行驶的神秘列车，只在暴雨夜出现，乘客通常带着未完成的执念。',
  },
  {
    id: 'w-2',
    novelId: 'novel-1',
    title: '第七码厢',
    type: 'location',
    content: '不存在于列车图纸中的隐藏车厢，进入者会看见自己最想遗忘的记忆。',
  },
  {
    id: 'w-3',
    novelId: 'novel-1',
    title: '列车规则',
    type: 'rule',
    content: '不得无故更换座位；广播响起时必须保持安静；若看见无编号车厢，最好立刻离开。',
  },
  {
    id: 'w-4',
    novelId: 'novel-1',
    title: '记忆回响',
    type: 'history',
    content: '列车会把乘客的未完成记忆折射成物理空间，越接近终点，回响越具攻击性。',
  },
]

export const characterRelations: CharacterRelation[] = [
  {
    id: 'rel-1',
    novelId: 'novel-1',
    fromCharacterId: 'c-1',
    toCharacterId: 'c-2',
    label: '试探 / 吸引',
    strength: 'strong',
    status: 'active',
    note: '林砚对闻舟保持警惕，但也被他掌握的线索吸引。',
    chapterIds: ['ch-2', 'ch-3'],
  },
  {
    id: 'rel-2',
    novelId: 'novel-1',
    fromCharacterId: 'c-2',
    toCharacterId: 'c-1',
    label: '引导 / 隐瞒',
    strength: 'strong',
    status: 'hidden',
    note: '闻舟知道更多真相，但不会一次性说透。',
    chapterIds: ['ch-2', 'ch-3'],
  },
  {
    id: 'rel-3',
    novelId: 'novel-1',
    fromCharacterId: 'c-3',
    toCharacterId: 'c-1',
    label: '规则压迫',
    strength: 'medium',
    status: 'active',
    note: '广播女声并非单纯播报，更像在持续施压和校正林砚的行动。',
    chapterIds: ['ch-1', 'ch-2', 'ch-4'],
  },
]

export const timelineEvents: TimelineEvent[] = [
  {
    id: 'tl-1',
    novelId: 'novel-1',
    title: '暴雨夜登车',
    phase: '序幕',
    worldline: '主线',
    summary: '林砚在记忆缺损的状态下登上灰烬列车，接触第七码厢警告。',
    order: 1,
    chapterIds: ['ch-1'],
  },
  {
    id: 'tl-2',
    novelId: 'novel-1',
    title: '闻舟登场',
    phase: '第一幕',
    worldline: '主线',
    summary: '闻舟在列车离站前最后一秒进入车厢，带来新的不确定性。',
    order: 2,
    chapterIds: ['ch-2'],
  },
  {
    id: 'tl-3',
    novelId: 'novel-1',
    title: '进入第七码厢',
    phase: '第一幕转折',
    worldline: '主线',
    summary: '林砚违背警告进入隐藏车厢，正式触碰列车规则背后的真相。',
    order: 3,
    chapterIds: ['ch-3'],
  },
  {
    id: 'tl-4',
    novelId: 'novel-1',
    title: '命运回声',
    phase: '第二幕铺垫',
    worldline: '心理线',
    summary: '林砚开始听见关于自己名字的回响，记忆与命运线交缠。',
    order: 4,
    chapterIds: ['ch-4'],
  },
]

export const rewriteCandidates: RewriteCandidate[] = [
  {
    id: 'r-1',
    batchId: 'batch-seed-1',
    title: '候选版本 A · 压迫感增强',
    summary: '保留原情节，强化上车瞬间的紧张与不祥气息。',
    mode: 'light',
    tone: 'dark',
    selected: true,
    createdAt: '18:02',
    prompt: '增强压迫感，不改变关键设定',
    sourceExcerpt: '站台上没有风，只有雨。列车在雾里发出低沉的鸣笛……',
    actions: ['apply', 'insert', 'branch', 'continue'],
    content:
      '站台上没有风，雨却像一层无声落下的铁网。列车从雾里缓缓逼近，车灯被水汽吞成两团模糊的白火。林砚抱着那只旧手提箱，指节因为过度用力而微微泛白。她知道自己应该上车，却本能地觉得，黄线之后不是旅途的开始，而是某种早已写好的宣判。',
  },
  {
    id: 'r-2',
    batchId: 'batch-seed-1',
    title: '候选版本 B · 轻小说节奏',
    summary: '加快节奏，弱化沉重铺陈，让开场更有推进感。',
    mode: 'medium',
    tone: 'light-novel',
    selected: false,
    createdAt: '18:02',
    prompt: '提高节奏和钩子强度',
    sourceExcerpt: '林砚抱着那只磨损严重的手提箱，站在黄线之后……',
    actions: ['apply', 'insert', 'branch', 'continue'],
    content:
      '暴雨砸在站台棚顶，噼里啪啦吵得人心烦。林砚抱着旧手提箱站在黄线后，盯着那辆从雾里钻出来的列车，心里只有一个念头——她八成不该上这趟车。但手里的车票已经被雨水泡得发皱，背面那句“不要进入第七码厢”反而让她更想搞清楚，这到底是警告，还是邀请。',
  },
  {
    id: 'r-3',
    batchId: 'batch-seed-1',
    title: '候选版本 C · 主动分支',
    summary: '把主角写得更主动，适合直接切到分支推进。',
    mode: 'branch',
    tone: 'dramatic',
    selected: false,
    createdAt: '18:02',
    prompt: '提高主角行动性，方便分支展开',
    sourceExcerpt: '她并不记得自己为什么会来到这里……',
    actions: ['apply', 'insert', 'branch', 'continue'],
    content:
      '列车靠站时，林砚没有再犹豫。她抬手抹掉睫毛上的雨水，攥紧那张发软的车票，径直跨过黄线，像是终于对某个拖延已久的答案下了决心。她不记得自己为什么会来，但她清楚，如果今晚不上车，她以后再也不会知道真相。',
  },
]

export const defaultPresets: RewritePreset[] = [
  {
    id: 'preset-1',
    name: '冷感压迫',
    mode: 'heavy',
    tone: 'colder',
    prompt: '压低情绪外露，提高压迫感与空间细节，避免解释性台词。',
  },
  {
    id: 'preset-2',
    name: '电影镜头',
    mode: 'perspective',
    tone: 'cinematic',
    prompt: '以镜头推进为优先，增强动作和环境切换，减少抽象比喻。',
  },
  {
    id: 'preset-3',
    name: '对话拉扯',
    mode: 'dialogue',
    tone: 'romantic',
    prompt: '强化角色之间的张力与潜台词，不要破坏既有设定。',
  },
]

export const defaultConstraints: RewriteConstraint[] = [
  { id: 'cons-1', label: '不改世界观规则', enabled: true, strength: 'strict' },
  { id: 'cons-2', label: '保留关键伏笔词', enabled: true, strength: 'soft' },
  { id: 'cons-3', label: '避免现代口语跳戏', enabled: false, strength: 'soft' },
  { id: 'cons-4', label: '控制单段长度', enabled: true, strength: 'soft' },
]

export const seedTrajectories: TrajectoryEntry[] = [
  {
    id: 'traj-1',
    chapterId: 'ch-1',
    type: 'rewrite',
    title: '初版候选批次',
    detail: '围绕开篇站台场景生成 3 个候选，分别强调压迫感、节奏和主角主动性。',
    createdAt: '18:02',
  },
  {
    id: 'traj-2',
    chapterId: 'ch-2',
    type: 'note',
    title: '闻舟危险感保留',
    detail: '后续所有改写都应保留闻舟“像刀锋一样薄”的初见印象。',
    createdAt: '17:48',
  },
]
