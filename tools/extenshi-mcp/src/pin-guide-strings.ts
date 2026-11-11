/**
 * Pin guide captions — the step titles, bodies and alt text of the "find the
 * extension and pin it" sequence, in every language our end-user pages ship in.
 *
 * SELF-CONTAINED ON PURPOSE — no imports, so it can be copied verbatim into the
 * published `@extenshi/mcp` and `@extenshi/cli` packages, which cannot depend on
 * unpublished workspace packages (same constraint as welcome-agent-brief.ts).
 *
 * SINGLE SOURCE, THREE COPIES. The three pin-guide files (pin-guide.ts,
 * pin-guide-strings.ts, pin-guide-kit.ts) live canonically in shared-types and
 * are copied into tools/extenshi-mcp/src and tools/extenshi-cli/src with their
 * `shared-types/` import specifiers rewritten to `./` — otherwise identical.
 * After editing any of them, run from the repo root:
 *   for f in pin-guide pin-guide-strings pin-guide-kit; do for d in tools/extenshi-mcp/src tools/extenshi-cli/src; do
 *     sed "s#from 'shared-types\/#from './#" shared-types/$f.ts > $d/$f.ts
 *   done; done
 * Sync tests in both packages fail CI on drift.
 *
 * The English text is the text the hosted welcome pages have always rendered,
 * byte for byte — `buildPinGuideBlocks` without a locale must not change.
 *
 * Naming the browser's own controls is the part that has to be right: a guide
 * that tells the user to click a menu item their browser does not have is
 * worse than no guide. So a control is quoted only where we hold the browser's
 * actual string for that language:
 *   - Firefox "Pin to Toolbar" — from Mozilla's localization repository
 *     (mozilla-l10n/firefox-l10n, browser/browser/unifiedExtensions.ftl,
 *     `unified-extensions-context-menu-pin-to-toolbar`, checked 2026-11-04).
 *   - Edge — a pushpin glyph with no visible label, like Chrome. (Earlier
 *     Edge versions showed an eye captioned "Show in toolbar"; the current
 *     menu has an outlined pin followed by a ⋯ button.)
 *   - Chrome — the control is a pushpin glyph with no visible label.
 */

/** Same list as END_USER_LOCALES (shared-types/end-user-locale.ts), pinned by a test. */
export const PIN_GUIDE_LOCALES = [
	'en',
	'es',
	'pt-BR',
	'fr',
	'de',
	'it',
	'ru',
	'ja',
	'ko',
	'zh-CN',
	'ar',
] as const
export type PinGuideLocale = (typeof PIN_GUIDE_LOCALES)[number]

type PerBrowser = Record<'chrome' | 'edge' | 'firefox', string>

/**
 * Templates take two placeholders: `{name}` (the extension's display name) and
 * `{browser}` (Chrome / Edge / Firefox). Fill them with `pinGuideText`.
 */
export interface PinGuideStrings {
	step1Title: string
	step1Body: string
	step1Alt: string
	step2Title: string
	step2Alt: string
	/** Step 3 is the toggle, which is the one control that differs per browser. */
	step3Title: PerBrowser
	step3Body: PerBrowser
	step3Alt: PerBrowser
	/**
	 * Firefox's own label for the menu item, drawn inside the step-3
	 * illustration. The same string the Firefox step3Title quotes.
	 */
	step3MenuItem: string
	step4Title: string
	step4Body: string
	step4Alt: string
}

const EN_MISS = 'This is the step most people miss — opening the menu is not the same as pinning.'

export const PIN_GUIDE_STRINGS: Record<PinGuideLocale, PinGuideStrings> = {
	en: {
		step1Title: 'Click the puzzle icon in the {browser} toolbar',
		step1Body: '{browser} hides newly installed extensions behind it.',
		step1Alt: 'The {browser} toolbar with the puzzle icon highlighted in the top right',
		step2Title: 'Find {name} in the list',
		step2Alt: 'The open extensions menu with {name} highlighted',
		step3Title: {
			chrome: 'Click the pin icon next to it',
			edge: 'Click the pin icon next to it',
			firefox: 'Open the ⋯ menu next to it and choose “Pin to Toolbar”',
		},
		step3Body: {
			chrome: EN_MISS,
			edge: EN_MISS,
			firefox: EN_MISS,
		},
		step3Alt: {
			chrome: 'Close-up of the {name} row in the extensions menu, with the pin toggle highlighted',
			edge: 'Close-up of the {name} row in the extensions menu, with the pin toggle highlighted',
			firefox:
				'Close-up of the {name} row in the extensions menu, with the ⋯ overflow button highlighted and its menu open on “Pin to Toolbar”',
		},
		step3MenuItem: 'Pin to Toolbar',
		step4Title: 'Done — the icon now sits in your toolbar',
		step4Body: 'Click it any time to open the extension.',
		step4Alt: 'The {browser} toolbar with the {name} icon pinned next to the address bar',
	},
	es: {
		step1Title: 'Haz clic en el icono de la pieza de puzle en la barra de herramientas de {browser}',
		step1Body: '{browser} oculta ahí las extensiones recién instaladas.',
		step1Alt:
			'La barra de herramientas de {browser} con el icono de la pieza de puzle resaltado arriba a la derecha',
		step2Title: 'Busca {name} en la lista',
		step2Alt: 'El menú de extensiones abierto con la fila de {name} resaltada',
		step3Title: {
			chrome: 'Haz clic en el icono de la chincheta que está al lado',
			edge: 'Haz clic en el icono de la chincheta que está al lado',
			firefox: 'Abre el menú ⋯ que está al lado y elige «Fijar a la barra de herramientas»',
		},
		step3Body: {
			chrome:
				'Es el paso que casi todo el mundo se salta: abrir el menú no es lo mismo que fijar la extensión.',
			edge: 'Es el paso que casi todo el mundo se salta: abrir el menú no es lo mismo que fijar la extensión.',
			firefox:
				'Es el paso que casi todo el mundo se salta: abrir el menú no es lo mismo que fijar la extensión.',
		},
		step3Alt: {
			chrome:
				'Vista ampliada de la fila de {name} en el menú de extensiones, con el botón de fijar resaltado',
			edge: 'Vista ampliada de la fila de {name} en el menú de extensiones, con el botón de fijar resaltado',
			firefox:
				'Vista ampliada de la fila de {name} en el menú de extensiones, con el botón ⋯ resaltado y su menú abierto en «Fijar a la barra de herramientas»',
		},
		step3MenuItem: 'Fijar a la barra de herramientas',
		step4Title: 'Listo: el icono ya está en tu barra de herramientas',
		step4Body: 'Haz clic en él cuando quieras para abrir la extensión.',
		step4Alt:
			'La barra de herramientas de {browser} con el icono de {name} fijado junto a la barra de direcciones',
	},
	'pt-BR': {
		step1Title: 'Clique no ícone de quebra-cabeça na barra de ferramentas do {browser}',
		step1Body: 'O {browser} esconde ali as extensões recém-instaladas.',
		step1Alt:
			'A barra de ferramentas do {browser} com o ícone de quebra-cabeça destacado no canto superior direito',
		step2Title: 'Encontre {name} na lista',
		step2Alt: 'O menu de extensões aberto com a linha de {name} destacada',
		step3Title: {
			chrome: 'Clique no ícone de alfinete ao lado',
			edge: 'Clique no ícone de alfinete ao lado',
			firefox: 'Abra o menu ⋯ ao lado e escolha “Fixar na barra de ferramentas”',
		},
		step3Body: {
			chrome: 'É a etapa que quase todo mundo pula: abrir o menu não é o mesmo que fixar a extensão.',
			edge: 'É a etapa que quase todo mundo pula: abrir o menu não é o mesmo que fixar a extensão.',
			firefox: 'É a etapa que quase todo mundo pula: abrir o menu não é o mesmo que fixar a extensão.',
		},
		step3Alt: {
			chrome: 'Detalhe da linha de {name} no menu de extensões, com o botão de fixar destacado',
			edge: 'Detalhe da linha de {name} no menu de extensões, com o botão de fixar destacado',
			firefox:
				'Detalhe da linha de {name} no menu de extensões, com o botão ⋯ destacado e o menu dele aberto em “Fixar na barra de ferramentas”',
		},
		step3MenuItem: 'Fixar na barra de ferramentas',
		step4Title: 'Pronto: o ícone agora fica na sua barra de ferramentas',
		step4Body: 'Clique nele a qualquer momento para abrir a extensão.',
		step4Alt:
			'A barra de ferramentas do {browser} com o ícone de {name} fixado ao lado da barra de endereços',
	},
	fr: {
		step1Title: 'Cliquez sur l’icône en forme de pièce de puzzle dans la barre d’outils de {browser}',
		step1Body: '{browser} y range les extensions qui viennent d’être installées.',
		step1Alt: 'La barre d’outils de {browser} avec l’icône de puzzle mise en évidence en haut à droite',
		step2Title: 'Trouvez {name} dans la liste',
		step2Alt: 'Le menu des extensions ouvert, avec la ligne de {name} mise en évidence',
		step3Title: {
			chrome: 'Cliquez sur l’icône en forme d’épingle à côté',
			edge: 'Cliquez sur l’icône en forme d’épingle à côté',
			firefox: 'Ouvrez le menu ⋯ à côté et choisissez « Épingler à la barre d’outils »',
		},
		step3Body: {
			chrome:
				'C’est l’étape que presque tout le monde oublie : ouvrir le menu ne suffit pas à épingler l’extension.',
			edge: 'C’est l’étape que presque tout le monde oublie : ouvrir le menu ne suffit pas à épingler l’extension.',
			firefox:
				'C’est l’étape que presque tout le monde oublie : ouvrir le menu ne suffit pas à épingler l’extension.',
		},
		step3Alt: {
			chrome:
				'Gros plan sur la ligne de {name} dans le menu des extensions, avec le bouton d’épingle mis en évidence',
			edge: 'Gros plan sur la ligne de {name} dans le menu des extensions, avec le bouton d’épingle mis en évidence',
			firefox:
				'Gros plan sur la ligne de {name} dans le menu des extensions, avec le bouton ⋯ mis en évidence et son menu ouvert sur « Épingler à la barre d’outils »',
		},
		step3MenuItem: 'Épingler à la barre d’outils',
		step4Title: 'C’est fait : l’icône est maintenant dans votre barre d’outils',
		step4Body: 'Cliquez dessus à tout moment pour ouvrir l’extension.',
		step4Alt: 'La barre d’outils de {browser} avec l’icône de {name} épinglée à côté de la barre d’adresse',
	},
	de: {
		step1Title: 'Klicken Sie in der {browser}-Symbolleiste auf das Puzzle-Symbol',
		step1Body: '{browser} legt neu installierte Erweiterungen dort ab.',
		step1Alt: 'Die {browser}-Symbolleiste, oben rechts ist das Puzzle-Symbol hervorgehoben',
		step2Title: 'Suchen Sie {name} in der Liste',
		step2Alt: 'Das geöffnete Erweiterungsmenü, die Zeile von {name} ist hervorgehoben',
		step3Title: {
			chrome: 'Klicken Sie daneben auf das Pin-Symbol',
			edge: 'Klicken Sie daneben auf das Pin-Symbol',
			firefox: 'Öffnen Sie daneben das Menü ⋯ und wählen Sie „An Symbolleiste anheften“',
		},
		step3Body: {
			chrome:
				'Diesen Schritt übersehen die meisten: Das Menü zu öffnen heißt noch nicht, die Erweiterung anzuheften.',
			edge: 'Diesen Schritt übersehen die meisten: Das Menü zu öffnen heißt noch nicht, die Erweiterung anzuheften.',
			firefox:
				'Diesen Schritt übersehen die meisten: Das Menü zu öffnen heißt noch nicht, die Erweiterung anzuheften.',
		},
		step3Alt: {
			chrome: 'Nahansicht der Zeile von {name} im Erweiterungsmenü, der Pin-Schalter ist hervorgehoben',
			edge: 'Nahansicht der Zeile von {name} im Erweiterungsmenü, der Pin-Schalter ist hervorgehoben',
			firefox:
				'Nahansicht der Zeile von {name} im Erweiterungsmenü, die Schaltfläche ⋯ ist hervorgehoben, in ihrem geöffneten Menü ist „An Symbolleiste anheften“ markiert',
		},
		step3MenuItem: 'An Symbolleiste anheften',
		step4Title: 'Fertig – das Symbol ist jetzt in Ihrer Symbolleiste',
		step4Body: 'Klicken Sie jederzeit darauf, um die Erweiterung zu öffnen.',
		step4Alt: 'Die {browser}-Symbolleiste mit dem angehefteten Symbol von {name} neben der Adressleiste',
	},
	it: {
		step1Title: 'Fai clic sull’icona del puzzle nella barra degli strumenti di {browser}',
		step1Body: '{browser} nasconde lì le estensioni appena installate.',
		step1Alt: 'La barra degli strumenti di {browser} con l’icona del puzzle evidenziata in alto a destra',
		step2Title: 'Trova {name} nell’elenco',
		step2Alt: 'Il menu delle estensioni aperto con la riga di {name} evidenziata',
		step3Title: {
			chrome: 'Fai clic sull’icona della puntina accanto',
			edge: 'Fai clic sull’icona della puntina accanto',
			firefox: 'Apri il menu ⋯ accanto e scegli «Aggiungi alla barra degli strumenti»',
		},
		step3Body: {
			chrome: 'È il passaggio che quasi tutti saltano: aprire il menu non significa fissare l’estensione.',
			edge: 'È il passaggio che quasi tutti saltano: aprire il menu non significa fissare l’estensione.',
			firefox: 'È il passaggio che quasi tutti saltano: aprire il menu non significa fissare l’estensione.',
		},
		step3Alt: {
			chrome:
				'Primo piano della riga di {name} nel menu delle estensioni, con il pulsante della puntina evidenziato',
			edge: 'Primo piano della riga di {name} nel menu delle estensioni, con il pulsante della puntina evidenziato',
			firefox:
				'Primo piano della riga di {name} nel menu delle estensioni, con il pulsante ⋯ evidenziato e il suo menu aperto su «Aggiungi alla barra degli strumenti»',
		},
		step3MenuItem: 'Aggiungi alla barra degli strumenti',
		step4Title: 'Fatto: ora l’icona è nella barra degli strumenti',
		step4Body: 'Fai clic quando vuoi per aprire l’estensione.',
		step4Alt:
			'La barra degli strumenti di {browser} con l’icona di {name} fissata accanto alla barra degli indirizzi',
	},
	ru: {
		step1Title: 'Нажмите на значок пазла на панели инструментов {browser}',
		step1Body: '{browser} прячет туда только что установленные расширения.',
		step1Alt: 'Панель инструментов {browser}, справа вверху выделен значок пазла',
		step2Title: 'Найдите {name} в списке',
		step2Alt: 'Открытое меню расширений, выделена строка {name}',
		step3Title: {
			chrome: 'Нажмите на значок булавки рядом',
			edge: 'Нажмите на значок булавки рядом',
			firefox: 'Откройте меню ⋯ рядом и выберите «Закрепить на панели инструментов»',
		},
		step3Body: {
			chrome: 'Этот шаг пропускают чаще всего: открыть меню — ещё не значит закрепить расширение.',
			edge: 'Этот шаг пропускают чаще всего: открыть меню — ещё не значит закрепить расширение.',
			firefox: 'Этот шаг пропускают чаще всего: открыть меню — ещё не значит закрепить расширение.',
		},
		step3Alt: {
			chrome: 'Крупный план строки {name} в меню расширений, выделена кнопка закрепления',
			edge: 'Крупный план строки {name} в меню расширений, выделена кнопка закрепления',
			firefox:
				'Крупный план строки {name} в меню расширений, выделена кнопка ⋯, в её открытом меню отмечен пункт «Закрепить на панели инструментов»',
		},
		step3MenuItem: 'Закрепить на панели инструментов',
		step4Title: 'Готово — значок теперь на панели инструментов',
		step4Body: 'Нажимайте на него, когда нужно открыть расширение.',
		step4Alt: 'Панель инструментов {browser}, значок {name} закреплён рядом с адресной строкой',
	},
	ja: {
		step1Title: '{browser} のツールバーにあるパズルのアイコンをクリックします',
		step1Body: '{browser} では、インストールしたばかりの拡張機能はここにまとめられます。',
		step1Alt: '{browser} のツールバー。右上のパズルのアイコンが強調表示されています',
		step2Title: '一覧から {name} を探します',
		step2Alt: '開いた拡張機能メニュー。{name} の行が強調表示されています',
		step3Title: {
			chrome: '横にあるピンのアイコンをクリックします',
			edge: '横にあるピンのアイコンをクリックします',
			firefox: '横にある ⋯ メニューを開き、「ツールバーにピン留め」を選びます',
		},
		step3Body: {
			chrome: '多くの人が見落とす手順です。メニューを開いただけではピン留めされません。',
			edge: '多くの人が見落とす手順です。メニューを開いただけではピン留めされません。',
			firefox: '多くの人が見落とす手順です。メニューを開いただけではピン留めされません。',
		},
		step3Alt: {
			chrome: '拡張機能メニューの {name} の行の拡大図。ピンのボタンが強調表示されています',
			edge: '拡張機能メニューの {name} の行の拡大図。ピンのボタンが強調表示されています',
			firefox:
				'拡張機能メニューの {name} の行の拡大図。⋯ ボタンが強調表示され、開いたメニューで「ツールバーにピン留め」が選ばれています',
		},
		step3MenuItem: 'ツールバーにピン留め',
		step4Title: '完了です。アイコンがツールバーに表示されました',
		step4Body: 'いつでもクリックして拡張機能を開けます。',
		step4Alt: '{browser} のツールバー。{name} のアイコンがアドレスバーの横にピン留めされています',
	},
	ko: {
		step1Title: '{browser} 도구 모음에서 퍼즐 아이콘을 클릭하세요',
		step1Body: '새로 설치한 확장 프로그램은 {browser}에서 이 아이콘 안에 숨겨집니다.',
		step1Alt: '{browser} 도구 모음, 오른쪽 위의 퍼즐 아이콘이 강조 표시됨',
		step2Title: '목록에서 {name} 항목을 찾으세요',
		step2Alt: '열린 확장 프로그램 메뉴, {name} 행이 강조 표시됨',
		step3Title: {
			chrome: '옆에 있는 핀 아이콘을 클릭하세요',
			edge: '옆에 있는 핀 아이콘을 클릭하세요',
			firefox: '옆에 있는 ⋯ 메뉴를 열고 “도구 모음에 고정”을 선택하세요',
		},
		step3Body: {
			chrome: '가장 많이 놓치는 단계입니다. 메뉴를 여는 것만으로는 고정되지 않습니다.',
			edge: '가장 많이 놓치는 단계입니다. 메뉴를 여는 것만으로는 고정되지 않습니다.',
			firefox: '가장 많이 놓치는 단계입니다. 메뉴를 여는 것만으로는 고정되지 않습니다.',
		},
		step3Alt: {
			chrome: '확장 프로그램 메뉴의 {name} 행 확대 화면, 고정 버튼이 강조 표시됨',
			edge: '확장 프로그램 메뉴의 {name} 행 확대 화면, 고정 버튼이 강조 표시됨',
			firefox:
				'확장 프로그램 메뉴의 {name} 행 확대 화면, ⋯ 버튼이 강조 표시되고 열린 메뉴에서 “도구 모음에 고정”이 선택됨',
		},
		step3MenuItem: '도구 모음에 고정',
		step4Title: '완료되었습니다. 이제 아이콘이 도구 모음에 표시됩니다',
		step4Body: '언제든지 아이콘을 클릭해 확장 프로그램을 여세요.',
		step4Alt: '{browser} 도구 모음, 주소 표시줄 옆에 {name} 아이콘이 고정됨',
	},
	'zh-CN': {
		step1Title: '点击 {browser} 工具栏中的拼图图标',
		step1Body: '{browser} 会把新安装的扩展程序收在这里。',
		step1Alt: '{browser} 工具栏，右上角的拼图图标已突出显示',
		step2Title: '在列表中找到 {name}',
		step2Alt: '已打开的扩展程序菜单，{name} 所在行已突出显示',
		step3Title: {
			chrome: '点击旁边的图钉图标',
			edge: '点击旁边的图钉图标',
			firefox: '打开旁边的 ⋯ 菜单，选择“固定到工具栏”',
		},
		step3Body: {
			chrome: '这是最容易漏掉的一步：打开菜单并不等于固定扩展程序。',
			edge: '这是最容易漏掉的一步：打开菜单并不等于固定扩展程序。',
			firefox: '这是最容易漏掉的一步：打开菜单并不等于固定扩展程序。',
		},
		step3Alt: {
			chrome: '扩展程序菜单中 {name} 所在行的特写，图钉按钮已突出显示',
			edge: '扩展程序菜单中 {name} 所在行的特写，图钉按钮已突出显示',
			firefox: '扩展程序菜单中 {name} 所在行的特写，⋯ 按钮已突出显示，展开的菜单中选中了“固定到工具栏”',
		},
		step3MenuItem: '固定到工具栏',
		step4Title: '完成，图标现在固定在工具栏中',
		step4Body: '随时点击它即可打开扩展程序。',
		step4Alt: '{browser} 工具栏，{name} 的图标已固定在地址栏旁边',
	},
	// "تثبيت" means both "install" and "pin" in Arabic browser UIs, so the copy
	// says "new extensions" for installs and anchors every pin to the toolbar.
	ar: {
		step1Title: 'انقر على أيقونة قطعة الأحجية في شريط أدوات {browser}',
		step1Body: 'يُخفي {browser} الإضافات الجديدة خلفها.',
		step1Alt: 'شريط أدوات {browser} مع إبراز أيقونة قطعة الأحجية في أعلى النافذة',
		step2Title: 'ابحث عن {name} في القائمة',
		step2Alt: 'قائمة الإضافات مفتوحة مع إبراز صف {name}',
		step3Title: {
			chrome: 'انقر على أيقونة الدبوس بجانبها',
			edge: 'انقر على أيقونة الدبوس بجانبها',
			firefox: 'افتح قائمة ⋯ بجانبها واختر «ثبّته في شريط الأدوات»',
		},
		step3Body: {
			chrome: 'هذه هي الخطوة التي يفوّتها معظم الناس: فتح القائمة لا يعني تثبيت الإضافة في شريط الأدوات.',
			edge: 'هذه هي الخطوة التي يفوّتها معظم الناس: فتح القائمة لا يعني تثبيت الإضافة في شريط الأدوات.',
			firefox: 'هذه هي الخطوة التي يفوّتها معظم الناس: فتح القائمة لا يعني تثبيت الإضافة في شريط الأدوات.',
		},
		step3Alt: {
			chrome: 'لقطة مقرّبة لصف {name} في قائمة الإضافات مع إبراز زر الدبوس',
			edge: 'لقطة مقرّبة لصف {name} في قائمة الإضافات مع إبراز زر الدبوس',
			firefox:
				'لقطة مقرّبة لصف {name} في قائمة الإضافات مع إبراز زر ⋯ وقائمته مفتوحة على «ثبّته في شريط الأدوات»',
		},
		step3MenuItem: 'ثبّته في شريط الأدوات',
		step4Title: 'تمّ — أصبحت الأيقونة الآن في شريط الأدوات',
		step4Body: 'انقر عليها في أي وقت لفتح الإضافة.',
		step4Alt: 'شريط أدوات {browser} وأيقونة {name} مثبّتة بجانب شريط العنوان',
	},
}

/** Resolve a BCP 47 tag (`pt_BR`, `zh-cn`, `fr-CA`) to a supported locale, else English. */
export function pinGuideLocale(tag: string | null | undefined): PinGuideLocale {
	const t = (tag ?? '').trim().replaceAll('_', '-').toLowerCase()
	const exact = PIN_GUIDE_LOCALES.find((l) => l.toLowerCase() === t)
	if (exact) return exact
	const [base, ...rest] = t.split('-')
	if (base === 'pt') return 'pt-BR'
	// Simplified script only: a Traditional-script reader is better served by
	// English than by characters they were not taught.
	if (base === 'zh') return rest.some((p) => ['hant', 'tw', 'hk', 'mo'].includes(p)) ? 'en' : 'zh-CN'
	return PIN_GUIDE_LOCALES.find((l) => l === base) ?? 'en'
}

/**
 * Fill `{name}` and `{browser}` in one pass, so a name that itself contains
 * `{browser}` is printed literally rather than substituted twice.
 */
export function pinGuideText(template: string, vars: { name: string; browser: string }): string {
	return template.replace(/\{(name|browser)\}/g, (_, key: 'name' | 'browser') => vars[key])
}
