# Remediation DRY-RUN plan — 2026-08-31T13:01:58.894Z

Policy: adopt live brand score; deterministic fixes only (waves A/B/C). 20 of 34 investigations change.

| Wave | What | Changes |
|---|---|---:|
| D | external corroboration recorded on the brand row (source-traceable, re-verified) | 4 |
| A0 | scam_score column := live brand score | 0 |
| A1 | old-score "N/100" literals | 0 |
| A2 | other threat-score "N/100" literals (context-gated) | 0 |
| B | metric literals + stale observation windows → canonical values | 327 |
| B-skip | day-counts next to unmatchable date windows — left for regeneration | 197 |
| C1 | fraud assertions → hedged register | 0 |
| C2 | sub-Elevated "Do not deposit" → verification directive | 0 |

## /review/blackrose-finbitnex  (published; score 26 → 26; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Sophie D | SKIPPED — looks truncated/damaged; needs human confirmation |
| B | `item_list` | (absent) | Phara de Aguirre |
| B | `item_list` | (absent) | Piotr Cieplak |
| B | `item_list` | (absent) | Rob de Nijs |
| B | `item_list` | (absent) | Robert Jensen |
| B | `item_list` | (absent) | Roger Laboureur |
| B | `item_list` | (absent) | Ross Adler |
| B | `item_list` | (absent) | Sir Michael Hill |
| B | `item_list` | (absent) | Tim Verheyden |
| B | `item_list` | (absent) | Bart De Wever |
| B | `item_list` | (absent) | Tomáš Sedláček |
| B | `item_list` | (absent) | Věra Křesadlová |
| B | `item_list` | (absent) | Victoria Velvet |
| B | `item_list` | (absent) | Willy Naessens |
| B | `item_list` | (absent) | Wim Van Belleghem |

## /review/crest-fundgrove  (published; score 5 → 5; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Avery Haines |
| B | `item_list` | (absent) | Chris Hadfield |
| B | `item_list` | (absent) | Erica Johnson |
| B | `item_list` | (absent) | Jagmeet Singh |

## /review/equiloompro  (published; score 34 → 34; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Κυριάκος Μητσοτάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ίλον Μασκ | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Τατιάνα Στεφανίδου | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Σπύρος Λάτσης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Χάρης Βαφειάς | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Γιάνης Βαρουφάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سمو الشيخ منصور بن زايد | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد العبار | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد المنصوري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | فاطمة المهيري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 김범수 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 박지훈 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 김병주 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 문재인 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 이재명 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 堀江貴文 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 小池百合子 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 柳井正 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 浜田 雅功 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 山田 孝之 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Alfred Gantner |
| B | `item_list` | (absent) | Ernesto Bertarelli |
| B | `item_list` | (absent) | Carlos Slim |
| B | `item_list` | (absent) | Claudia Sheinbaum |
| B | `item_list` | (absent) | Javier Milei |
| B | `item_list` | (absent) | Marcos Galperin |
| B | `item_list` | (absent) | Lars Seier Christensen |
| B | `item_list` | (absent) | Mikael Bertelsen |
| B | `item_list` | (absent) | Nikolaj Vammen |
| B | `item_list` | (absent) | Pau García-Milà |
| B | `item_list` | (absent) | Peter Hinssen |
| B | `item_list` | (absent) | Raoul Hedebouw |
| B | `item_list` | (absent) | Sariha Moya |
| B | `item_list` | (absent) | None |
| B | `item_list` | (absent) | Tan Sri Tony Fernandes |
| B | `item_list` | (absent) | Tarcísio de Freitas |
| B | `item_list` | (absent) | Tengku Zafrul Aziz |
| B | `item_list` | (absent) | Thomas Jordan |
| B | `item_list` | (absent) | Tony Fernandes |
| B | `item_list` | (absent) | Ueli Maurer |
| B | `item_list` | (absent) | Vico Sotto |
| B | `item_list` | (absent) | Wat Wing-yin |
| B | `item_list` | (absent) | Joseph Yam |
| B | `item_list` | (absent) | Willy Naessens |
| B | `item_list` | (absent) | Wong Cho-lam |
| B | `item_list` | (absent) | Paul Chan |

## /review/fino-inversor-a  (published; score 8 → 8; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Isak Andic |

## /review/floventra  (draft; score 16 → 16; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | الشيخ محمد بن عبد الرحمن آل ثاني |
| B | `item_list` | (absent) | علي بن أحمد الكواري |
| B | `item_list` | (absent) | محمد الكواري |
| B | `item_list` | (absent) | ياسر الرميان |
| B | `item_list` | (absent) | 黒田東彦 |
| B | `schema_json` | 26 public figures | 31 public figures |

## /review/halal-trade-ai  (published; score 17 → 17; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | أحمد حلمي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | نجوى كرم | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | الشيخ مشاري بن راشد العفاسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أنس بوشاش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | المفتي منك | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عبدالله المديفر | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | جاسم المطوع | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | فيصل عبدالرحمن العقل | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | ناصر القصبي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | حمزة الفاضل | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | داوود حسين | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | فيصل القاسم | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | راشد الماجد | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سردار تونجر | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أنس بوخش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سعد الرفاعي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عبد الرحمن السديس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مشاري بن راشد العفاسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عبد الله بن حمد العطية | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | ماجد المهندس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عمرو أديب | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد العبار | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أيمن محمد السياري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | إبراهيم العساف | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | غادة عويس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد بن عبدالرحمن بن جاسم آل ثاني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مشاري راشد العفاسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مصطفى حسني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | نهاد حاطب أوغلو | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | هديل الفرس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | يوسف محمد الجيدة | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | يوسف محمد الزايدة | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | يوسف محمد الزيدة | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Ahmed Al Shugairi |
| B | `item_list` | (absent) | Dr. Hadeel Faras |
| B | `item_list` | (absent) | Asmaa Saif |
| B | `item_list` | (absent) | Huda Al-Awadhi |
| B | `item_list` | (absent) | Dr. Khaled Al Munif |
| B | `item_list` | (absent) | Hadeel Al-Fares |
| B | `item_list` | (absent) | Ammar Taqi |
| B | `item_list` | (absent) | Jassem Al-Mutawa |
| B | `item_list` | (absent) | Mishari bin Rashid Alafasy |
| B | `item_list` | (absent) | Mohammed bin Salman |
| B | `item_list` | (absent) | Tamim bin Hamad Al Thani |
| B | `item_list` | (absent) | Tuncer Bakırhan |
| B | `item_list` | (absent) | Fatih Altaylı |

## /review/immediate-bienestar  (published; score 21 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Abelardo de la Espriella |
| B | `item_list` | (absent) | James Rodríguez |
| B | `item_list` | (absent) | Francis Durman Esquivel |
| B | `item_list` | (absent) | Horacio Cartes |
| B | `item_list` | (absent) | Lionel Scaloni |
| B | `item_list` | (absent) | Elon Musk |

## /review/immediate-connect  (published; score 16 → 16; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Diego Della Valle |
| B | `item_list` | (absent) | Luca Cordero di Montezemolo |
| B | `item_list` | (absent) | Gianluca Vacchi |

## /review/immediate-v4-intal  (published; score 24 → 24; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Рogelio Ramírez de la O | SKIPPED — looks truncated/damaged; needs human confirmation |
| B | `item_list` | (absent) | Carlos Gajardo |
| B | `item_list` | (absent) | Emilia Navas |
| B | `item_list` | (absent) | Franklin Chang-Diaz |
| B | `item_list` | (absent) | Francisco Dall'Anese |
| B | `item_list` | (absent) | Frank Rainieri |
| B | `item_list` | (absent) | Luis Abinader |
| B | `item_list` | (absent) | José Raúl Mulino |
| B | `item_list` | (absent) | Ricardo Martinelli |
| B | `item_list` | (absent) | Laura Fernández Delgado |
| B | `item_list` | (absent) | Wilson Camacho |
| B | `item_list` | (absent) | Yeni Berenice Reynoso |

## /review/kaspi-ai  (published; score 9 → 9; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Elon Musk |

## /review/legacy-bitfundex  (published; score 38 → 38; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Giannina S. | SKIPPED — looks truncated/damaged; needs human confirmation |
| B-skip | `item_list` | María G | SKIPPED — looks truncated/damaged; needs human confirmation |
| B-skip | `item_list` | María V | SKIPPED — looks truncated/damaged; needs human confirmation |
| B-skip | `item_list` | Sophie D | SKIPPED — looks truncated/damaged; needs human confirmation |
| B-skip | `item_list` | Διονύσης Σαββόπουλος | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Άλκίνοος Ιωαννίδης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Νίκος Αλεξόπουλος | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κάιτι Γκρέι | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κώστας Σημίτης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Μαρία Σαράφογλου | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Γιώργος Παπαδάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Τάσος Τέλλογλου | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Γιάννης Στουρνάρας | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Τζόρτζιο Αρμάνι | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 이순재 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 이해찬 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 김민호 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 仲代達矢 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 白川良平 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 国谷裕子 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 植田和男 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 堀江貴文 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 許文龍 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 鈴木 修 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Alfonso Lizarazo |
| B | `item_list` | (absent) | Diva Jessurum |
| B | `item_list` | (absent) | Carlos Martini |
| B | `item_list` | (absent) | Arturo Villasanti |
| B | `item_list` | (absent) | Luis Carlos Sarmiento Angulo |
| B | `item_list` | (absent) | Ernestina Pais |
| B | `item_list` | (absent) | Fabien Pinckaers |
| B | `item_list` | (absent) | Fernando Henrique Cardoso |
| B | `item_list` | (absent) | Florentino Pérez |
| B | `item_list` | (absent) | Eduardo Inda |
| B | `item_list` | (absent) | Gloria Serra |
| B | `item_list` | (absent) | Francisco Pardo Piqueras |
| B | `item_list` | (absent) | Henrique Gouveia e Melo |
| B | `item_list` | (absent) | Álvaro Santos Pereira |
| B | `item_list` | (absent) | Indio Solari |
| B | `item_list` | (absent) | Joanna Słowińska |
| B | `item_list` | (absent) | Kuba Borysiak |
| B | `item_list` | (absent) | Jorge Javier Vázquez |
| B | `item_list` | (absent) | David Broncano |
| B | `item_list` | (absent) | Jort Kelder |
| B | `item_list` | (absent) | Jitse Groen |
| B | `item_list` | (absent) | Klaas Knot |
| B | `item_list` | (absent) | José Carlos Semenzato |
| B | `item_list` | (absent) | José Luis Ábalos |
| B | `item_list` | (absent) | Judith Williams |
| B | `item_list` | (absent) | Justine Katz |
| B | `item_list` | (absent) | Anne-Élisabeth Lemoine |
| B | `item_list` | (absent) | Karen Doggenweiler |
| B | `item_list` | (absent) | Rosanna Costa |
| B | `item_list` | (absent) | Kees van der Spek |
| B | `item_list` | (absent) | Manolo Solo |
| B | `item_list` | (absent) | Marc Vidal |
| B | `item_list` | (absent) | Risto Mejide |
| B | `item_list` | (absent) | Marcos Galperin |
| B | `item_list` | (absent) | Paolo Rocca |
| B | `item_list` | (absent) | Renato Machado |
| B | `item_list` | (absent) | Claude Troisgros |
| B | `item_list` | (absent) | Ernesto Paglia |
| B | `item_list` | (absent) | Paula Echevarría |
| B | `item_list` | (absent) | Rolando Carvajal |
| B | `item_list` | (absent) | Javier Quirós |
| B | `item_list` | (absent) | Ron Brandsteder |
| B | `item_list` | (absent) | Eva Jinek |
| B | `item_list` | (absent) | Roxana Moise |
| B | `item_list` | (absent) | Sanja Musić Milanović |
| B | `item_list` | (absent) | Zoran Milanović |
| B | `item_list` | (absent) | Sara De Paduwa |
| B | `item_list` | (absent) | Soňa Müllerová |
| B | `item_list` | (absent) | Adela Vinczeová |
| B | `item_list` | (absent) | Štefan Kvietik |
| B | `item_list` | (absent) | Svetlana Ficová |
| B | `item_list` | (absent) | Robert Fico |
| B | `item_list` | (absent) | Tereza Kesovija |
| B | `item_list` | (absent) | Thiago Lolkus Nigro |
| B | `item_list` | (absent) | André Esteves |
| B | `item_list` | (absent) | Thomas Gottschalk |
| B | `item_list` | (absent) | Markus Lanz |
| B | `item_list` | (absent) | Tim Verheyden |
| B | `item_list` | (absent) | Bart De Wever |
| B | `item_list` | (absent) | Verónica Lozano |
| B | `item_list` | (absent) | Hugo Alconada Mon |
| B | `item_list` | (absent) | Voith Ági |
| B | `item_list` | (absent) | Zoran Šprajc |

## /review/nezertronixpro  (published; score 26 → 26; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Κωνσταντίνος Αν. Τασούλας | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ράνια Τζίμα | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Σία Κοσιώνη | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 제프리 앱스타인 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 유명환 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Milo Đukanović |
| B | `item_list` | (absent) | Quemil Yambay |
| B | `item_list` | (absent) | Ranil Wickremesinghe |
| B | `item_list` | (absent) | Chamuditha Samarawickrama |
| B | `item_list` | (absent) | Rubén Rubin |
| B | `item_list` | (absent) | Seun Okinbaloye |
| B | `item_list` | (absent) | Sheikh Mohammed bin Abdulrahman Al Thani |
| B | `item_list` | (absent) | Tanja Dexters |
| B | `item_list` | (absent) | Miguel Dheedene |
| B | `item_list` | (absent) | Victoria Villarruel |
| B | `item_list` | (absent) | Zoran Milanovic |
| B | `item_list` | (absent) | Zuzana Čaputová |

## /review/nordiqo  (published; score 21 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | David McWilliams |

## /review/prestara-nexor  (published; score 8 → 8; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | 屈穎妍 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 任志剛 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 陳嘉欣 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Chinkee Tan |
| B | `item_list` | (absent) | Eli M. Remolona Jr. |
| B | `item_list` | (absent) | Wat Wing-yin |
| B | `item_list` | (absent) | Joseph Yam |

## /review/primeaura  (published; score 46 → 46; ELEVATED_RISK)

| Wave | Field | From | To |
|---|---|---|---|
| B | `full_article` | 388 ads | 474 ads |
| B-skip | `item_list` | Ίλον Μασκ | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Μπιλ Γκέιτς | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κυριάκος Μητσοτάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Αντώνης Σρόιτερ | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κυριάκος Πιερακάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κωνσταντίνος Τασούλας | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κυριάκος Πιερρακάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Μανώλη Καλαντζή | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Νίκος Χριστοδουλίδης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Νίκος Μουτσινάς | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Σίσσυ Θεοδωσία Χρηστίδου | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Στέφανος Κασσελάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Τάκης Θεοδωρικάκος | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ана Николић | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Сергеј Трифуновић | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 劉德華 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 李家超 | SKIPPED — looks truncated/damaged; needs human confirmation |
| B-skip | `item_list` | 許紹雄 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Anca Dragu |
| B | `item_list` | (absent) | Natalia Morari |
| B | `item_list` | (absent) | Bola Tinubu |
| B | `item_list` | (absent) | Aleksandar Vučić |
| B | `item_list` | (absent) | Silvio Kutić |
| B | `item_list` | (absent) | Femi Otedola |
| B | `item_list` | (absent) | Frank Rainieri |
| B | `item_list` | (absent) | Giannis Antetokounmpo |
| B | `item_list` | (absent) | Godswill Akpabio |
| B | `item_list` | (absent) | Harini Amarasuriya |
| B | `item_list` | (absent) | Chaminda Gunasekara |
| B | `item_list` | (absent) | Jens Stoltenberg |
| B | `item_list` | (absent) | Joaquim Miranda Sarmento |
| B | `item_list` | (absent) | Johann Peter Rupert |
| B | `item_list` | (absent) | Johann Rupert |
| B | `item_list` | (absent) | Jeremy Maggs |
| B | `item_list` | (absent) | Nicky Oppenheimer |
| B | `item_list` | (absent) | Black Coffee |
| B | `item_list` | (absent) | Jonas Gahr Støre |
| B | `item_list` | (absent) | Juan Ponce Enrile |
| B | `item_list` | (absent) | Julius Malema |
| B | `item_list` | (absent) | Jennifer Zabasajja |
| B | `item_list` | (absent) | Kadaria Ahmed |
| B | `item_list` | (absent) | Kalonzo Musyoka |
| B | `item_list` | (absent) | Karianne Oldernes Tung |
| B | `item_list` | (absent) | Karyn Maughan |
| B | `item_list` | (absent) | Katarzyna Pełczyńska-Nałęcz |
| B | `item_list` | (absent) | Kevin O'Leary |
| B | `item_list` | (absent) | Lars Løkke Rasmussen |
| B | `item_list` | (absent) | Leni Robredo |
| B | `item_list` | (absent) | Louis Schweitzer |
| B | `item_list` | (absent) | Luka Modrić |
| B | `item_list` | (absent) | Magín Javier Díaz |
| B | `item_list` | (absent) | Manuel Estrella |
| B | `item_list` | (absent) | Marcelo Rebelo de Sousa |
| B | `item_list` | (absent) | Mark Carney |
| B | `item_list` | (absent) | Mark Shuttleworth |
| B | `item_list` | (absent) | Martha Karua |
| B | `item_list` | (absent) | Astar Njau |
| B | `item_list` | (absent) | Matamela Cyril Ramaphosa |
| B | `item_list` | (absent) | Mate Rimac |
| B | `item_list` | (absent) | Didier Bonnet |
| B | `item_list` | (absent) | Matt Comyn |
| B | `item_list` | (absent) | Maverick Aoko |
| B | `item_list` | (absent) | Minnie Dlamini |
| B | `item_list` | (absent) | Miroslav Mišković |
| B | `item_list` | (absent) | Veljko Lalić |
| B | `item_list` | (absent) | Mohammed bin Rashid Al Maktoum |
| B | `item_list` | (absent) | Mohammed bin Zayed Al Nahyan |
| B | `item_list` | (absent) | Mohammed Boujassoum |
| B | `item_list` | (absent) | Muhammadu Buhari |
| B | `item_list` | (absent) | Nasir El-Rufai |
| B | `item_list` | (absent) | Nelson Mandela |
| B | `item_list` | (absent) | Ngozi Okonjo-Iweala |
| B | `item_list` | (absent) | Lamido Sanusi |
| B | `item_list` | (absent) | Nicolai Wammen |
| B | `item_list` | (absent) | Nora Aunor |
| B | `item_list` | (absent) | Olusegun Obasanjo |
| B | `item_list` | (absent) | Onyi Odunukwe |
| B | `item_list` | (absent) | Paolo Rocca |
| B | `item_list` | (absent) | Paula Amorim |
| B | `item_list` | (absent) | Pedro Soares dos Santos |
| B | `item_list` | (absent) | Peter Ndegwa |
| B | `item_list` | (absent) | Peter Obi |
| B | `item_list` | (absent) | Péter Szijjártó |
| B | `item_list` | (absent) | Péter Ungár |
| B | `item_list` | (absent) | Pravin Gordhan |
| B | `item_list` | (absent) | Raffy Tulfo |
| B | `item_list` | (absent) | Raquel Peña |
| B | `item_list` | (absent) | Reem Al Hashimy |
| B | `item_list` | (absent) | Richard Maponya |
| B | `item_list` | (absent) | Rob Hersov |
| B | `item_list` | (absent) | Ronaldinho |
| B | `item_list` | (absent) | Rubby Pérez |
| B | `item_list` | (absent) | Ryan Reynolds |
| B | `item_list` | (absent) | Saqr Ghobash |
| B | `item_list` | (absent) | Savo Manojlović |
| B | `item_list` | (absent) | Seun Okinbaloye |
| B | `item_list` | (absent) | Wilder Ugo |
| B | `item_list` | (absent) | Shehu Sani |
| B | `item_list` | (absent) | Sir Michael Hill |
| B | `item_list` | (absent) | Stella Tembisa Ndabeni-Abrahams |
| B | `item_list` | (absent) | Tan Sri Tony Fernandes |
| B | `item_list` | (absent) | Thomas Gottschalk |
| B | `item_list` | (absent) | Tony Elumelu |
| B | `item_list` | (absent) | Eleni Giokos |
| B | `item_list` | (absent) | Uhuru Kenyatta |
| B | `item_list` | (absent) | Vanja Ćalović |
| B | `item_list` | (absent) | Vimal Shah |
| B | `item_list` | (absent) | William Ruto |
| B | `item_list` | (absent) | Zoran Milanovic |
| B | `item_list` | (absent) | Ivan Kovač |

## /review/quantum-ai  (published; score 86 → 86; CONFIRMED)

| Wave | Field | From | To |
|---|---|---|---|
| D | `scam_brands.alternate_domains` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | ["quantumai.co.com"] |
| D | `scam_brands.primary_domain` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | "quantumai.co" |
| D | `scam_brands.regulators_checked` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | [{"regulator":"FCA","jurisdiction":"GB","register_url":"https://register.fca.org.uk/","checked_at":" |
| D | `scam_brands.regulator_warnings` | (empty) _(reviews.sources[2] + reviews.citations[0]; re-verified live 2026-08-31)_ | [{"regulator":"FCA","jurisdiction":"GB","url":"https://www.fca.org.uk/news/warnings/quantum-ai","pub |

## /review/senvix  (published; score 47 → 47; ELEVATED_RISK)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Γιάννης Στουρνάρας | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ευάγγελος Μαρινάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ηλιάνα Κουλαρμάνη | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ευάγγελος Μυτιληναίος | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Θεόδωρος Φέσσας | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ίλον Μασκ | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Μπιλ Γκέιτς | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Κυριάκος Μητσοτάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Αντώνης Σρόιτερ | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Βαγγέλης Μαρινάκης | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | حكيم زياش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | كريستيانو رونالدو | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 孫正義 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 高市早苗 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Inés Arrimades |
| B | `item_list` | (absent) | José Neves |
| B | `item_list` | (absent) | Pablo Motos |
| B | `item_list` | (absent) | Pedro Sánchez |
| B | `item_list` | (absent) | Fernando Esteso |
| B | `item_list` | (absent) | Flavio Briatore |
| B | `item_list` | (absent) | François Bayrou |
| B | `item_list` | (absent) | Gabrielle Attal |
| B | `item_list` | (absent) | Frank Thelen |
| B | `item_list` | (absent) | Friedrich Merz |
| B | `item_list` | (absent) | Antonio Tajani |
| B | `item_list` | (absent) | Bruno Vespa |
| B | `item_list` | (absent) | Günther Jauch |
| B | `item_list` | (absent) | Ignacio Sánchez Galán |
| B | `item_list` | (absent) | Ilon Musk |
| B | `item_list` | (absent) | Iñaki Gabilondo |
| B | `item_list` | (absent) | Szymon Midera |
| B | `item_list` | (absent) | Jacek Olczak |
| B | `item_list` | (absent) | Jacob Kragelund |
| B | `item_list` | (absent) | Chris Vogelzang |
| B | `item_list` | (absent) | Jesper Buchs |
| B | `item_list` | (absent) | John Collison |
| B | `item_list` | (absent) | Jordi Évole |
| B | `item_list` | (absent) | Rodrigo Rato |
| B | `item_list` | (absent) | José Mourinho |
| B | `item_list` | (absent) | Karol Nawrocki |
| B | `item_list` | (absent) | Julia |
| B | `item_list` | (absent) | Klaus Zellmer |
| B | `item_list` | (absent) | Tomáš Salomon |
| B | `item_list` | (absent) | Lars Klingbeil |
| B | `item_list` | (absent) | Lars Seier Christensen |
| B | `item_list` | (absent) | Luís Montenegro |
| B | `item_list` | (absent) | Luka Modrić |
| B | `item_list` | (absent) | Marco Travaglio |
| B | `item_list` | (absent) | María Jesús Montero |
| B | `item_list` | (absent) | Maryla Rodowicz |
| B | `item_list` | (absent) | Matteo Salvini |
| B | `item_list` | (absent) | Andrea Illy |
| B | `item_list` | (absent) | Micheál Martin |
| B | `item_list` | (absent) | Onur Genç |
| B | `item_list` | (absent) | Paul Hüttel |
| B | `item_list` | (absent) | Pier Berlusconi |
| B | `item_list` | (absent) | Pier Silvio Berlusconi |
| B | `item_list` | (absent) | Pier Silvio |
| B | `item_list` | (absent) | Radosław Sikorski |
| B | `item_list` | (absent) | Rafał Brzoska |
| B | `item_list` | (absent) | Robert Lewandowski |
| B | `item_list` | (absent) | Rafał Trzaskowski |
| B | `item_list` | (absent) | Risto Mejide |
| B | `item_list` | (absent) | Sebastian Kulczyk |
| B | `item_list` | (absent) | Stelios Haji-Ioannou |
| B | `item_list` | (absent) | Szymon Hołownia |
| B | `item_list` | (absent) | Vincent Clerc |
| B | `item_list` | (absent) | Carsten Egeriis |
| B | `item_list` | (absent) | Yolanda Díaz |
| B | `item_list` | (absent) | Zoran Milanović |

## /review/trade-vector-ai  (published; score 42 → 42; ELEVATED_RISK)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | أباذر الحلواجي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أنس بخاش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أحمد العيسى | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عبدالله المديفر | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | علي العلياني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أسامة المسلم | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أسماء آل ثاني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | علا الفارس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أحمد الشقيري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أنس بوخاش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أنس بوخش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | إبراهيم السمادي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | الشيخ مشاري بن راشد العفاسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | بنغ شياو | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أنس بخش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | جاسم المطوع | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | فيصل عبدالرحمن العقل | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | جواهر بنت حمد بن سحيم آل ثاني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | علي بن طوار الكواري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | حسين الجسمي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | خالد رشيد الزياني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | خليفة صالح الهارون | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | د. هديل الفارسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | د.محمد جمال | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | د.هديل الفرس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | راشد الماجد | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | ريم الهاشمي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سارة الأميري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سارة العمري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سردار تونجر | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سعد الرفاعي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سلطان النيادي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سماح الحجري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عائض بن عبد الله القرني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عبد الرحمن السديس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عبد العزيز الغرير | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | علاء جابر | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | علي السلوم | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | علي منصور كيالي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عمر فارو | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | عهود الرومي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | فاتح سيفيراجيتش | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد العبار | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد العبّار | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | د. هديل فراس | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد سعدون الكواري | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | محمد فوزي الصقر | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مشاري العفاسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مشاري بن راشد العفاسي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | معمر عواد | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | إبراهيم استادي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | منى المؤيد | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مهند الوادية | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | سيسيليا رينالدو | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | مهيرة عبد العزيز | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | نبيل العوضي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | أحمد العربي | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | نور ستارز | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | واسم يوسف | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | ياسر القحطاني | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 太田光 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | 寺島実郎 | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Dawie Roodt |
| B | `item_list` | (absent) | Clement Manyathela |
| B | `item_list` | (absent) | Eugenio Derbez |
| B | `item_list` | (absent) | John Kani |
| B | `item_list` | (absent) | Peter Wong |
| B | `item_list` | (absent) | Norman Chan |
| B | `item_list` | (absent) | Safi Arpaguş |
| B | `item_list` | (absent) | Fatih Altaylı |
| B | `item_list` | (absent) | Zdeněk Troška |

## /review/tradegpt  (published; score 21 → 21; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Steven Abrahams |

## /review/visi-n-luxovel  (published; score 5 → 5; LIMITED_EVIDENCE)

| Wave | Field | From | To |
|---|---|---|---|
| B | `item_list` | (absent) | Gonzo |
| B | `item_list` | (absent) | Carlos Torres Vila |

## /review/whatsapp-ai  (published; score 28 → 28; UNDER_INVESTIGATION)

| Wave | Field | From | To |
|---|---|---|---|
| B-skip | `item_list` | Александр Петров | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Мария Иванова | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Алексей | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Алексей Морозов | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ирина Ковалёва | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Андрей Лебедев | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Екатерина Морозова | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Анна Ковальчук | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Дмитрий Литвиненко | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ион Стурза | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Ираклия Кобахидзе | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Гиорги Беридзе | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Марк Зукърбърг | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Павел Дуров | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Эмин Агаларов | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B-skip | `item_list` | Алишер Усманов | SKIPPED — unmapped non-Latin canonical key; identity not mechanically provable |
| B | `item_list` | (absent) | Алексей Morozov |
