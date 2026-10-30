# -*- coding: utf-8 -*-
"""Build offline admin dictionary from 全国省市表.xlsx plus unique county aliases."""
import json
import shutil
from collections import defaultdict
from pathlib import Path
from openpyxl import load_workbook

root = Path(r"C:\Users\kuaidi100\PricingWorkbench.Desktop")
src_xlsx = Path(r"D:\毛利分析\德邦10.12\全国省市表.xlsx")
out_dir = root / "Assets" / "geo"
out_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(src_xlsx, out_dir / "全国省市表.xlsx")

wb = load_workbook(src_xlsx, data_only=True)
ws = wb.active
rows = list(ws.iter_rows(min_row=2, values_only=True))

MUNI_FULL = {"北京市", "天津市", "上海市", "重庆市"}


def province_short(full):
    s = str(full or "").strip()
    for suffix in ("维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治区", "省", "市"):
        if s.endswith(suffix) and s not in ("北京市", "天津市", "上海市", "重庆市"):
            if suffix == "市":
                break
            s = s[: -len(suffix)]
            break
    if s in ("北京市", "天津市", "上海市", "重庆市"):
        s = s.replace("市", "")
    return s


def city_short(full):
    s = str(full or "").strip()
    for suffix in ("特别行政区", "矿区", "林区", "地区", "盟", "自治州", "市", "县"):
        if s.endswith(suffix) and len(s) > len(suffix) + 1:
            if suffix == "市" and s in MUNI_FULL:
                return s.replace("市", "")
            if suffix in ("市", "县") and len(s) - len(suffix) >= 2:
                return s[: -len(suffix)]
            if suffix not in ("市", "县"):
                # keep distinctive short forms similar to STD
                trimmed = s[: -len(suffix)]
                return trimmed if trimmed else s
    return s


provinces_map = {}
cities = []
for prov_full, city_full in rows:
    if not prov_full or not city_full:
        continue
    prov_full = str(prov_full).strip()
    city_full = str(city_full).strip()
    pshort = province_short(prov_full)
    cshort = city_short(city_full)
    if pshort not in provinces_map:
        aliases = {pshort, prov_full}
        if prov_full.endswith("省"):
            aliases.add(prov_full[:-1])
        provinces_map[pshort] = {"short": pshort, "full": prov_full, "aliases": sorted(aliases, key=lambda x: -len(x))}
    aliases = {cshort, city_full}
    if city_full.endswith("市") and city_full not in MUNI_FULL:
        aliases.add(city_full[:-1])
    cities.append({
        "province": pshort,
        "provinceFull": prov_full,
        "short": cshort,
        "full": city_full,
        "aliases": sorted({a for a in aliases if a}, key=lambda x: -len(x)),
    })

# Unique county / district aliases. Ambiguous names are omitted on purpose.
counties = [
    ("江苏", "苏州市", ["昆山", "昆山市", "张家港", "张家港市", "常熟", "常熟市", "太仓", "太仓市", "吴江", "吴江区"]),
    ("江苏", "无锡市", ["江阴", "江阴市", "宜兴", "宜兴市"]),
    ("江苏", "南京市", ["江宁", "江宁区", "浦口", "浦口区", "六合", "六合区", "溧水", "溧水区", "高淳", "高淳区"]),
    ("江苏", "常州市", ["金坛", "金坛区", "溧阳", "溧阳市"]),
    ("江苏", "南通市", ["海门", "海门区", "如皋", "如皋市", "启东", "启东市", "海安", "海安市"]),
    ("江苏", "徐州市", ["邳州", "邳州市", "新沂", "新沂市"]),
    ("江苏", "盐城市", ["东台", "东台市", "大丰", "大丰区"]),
    ("江苏", "扬州市", ["仪征", "仪征市", "高邮", "高邮市", "江都", "江都区"]),
    ("江苏", "镇江市", ["丹阳", "丹阳市", "扬中", "扬中市", "句容", "句容市"]),
    ("江苏", "泰州市", ["兴化", "兴化市", "靖江", "靖江市", "泰兴", "泰兴市", "姜堰", "姜堰区"]),
    ("浙江", "杭州市", ["萧山", "萧山区", "余杭", "余杭区", "临安", "临安区", "富阳", "富阳区", "桐庐", "桐庐县", "淳安", "淳安县", "建德", "建德市"]),
    ("浙江", "宁波市", ["慈溪", "慈溪市", "余姚", "余姚市", "奉化", "奉化区", "宁海", "宁海县", "象山", "象山县", "鄞州", "鄞州区", "海曙", "海曙区", "镇海", "镇海区", "北仑", "北仑区"]),
    ("浙江", "温州市", ["乐清", "乐清市", "瑞安", "瑞安市", "龙港", "龙港市", "永嘉", "永嘉县", "平阳", "平阳县", "苍南", "苍南县"]),
    ("浙江", "嘉兴市", ["海宁", "海宁市", "平湖", "平湖市", "桐乡", "桐乡市", "嘉善", "嘉善县", "海盐", "海盐县"]),
    ("浙江", "绍兴市", ["诸暨", "诸暨市", "嵊州", "嵊州市", "上虞", "上虞区", "新昌", "新昌县", "柯桥", "柯桥区"]),
    ("浙江", "金华市", ["义乌", "义乌市", "东阳", "东阳市", "永康", "永康市", "兰溪", "兰溪市"]),
    ("浙江", "台州市", ["温岭", "温岭市", "临海", "临海市", "玉环", "玉环市"]),
    ("广东", "深圳市", ["南山", "南山区", "福田", "福田区", "罗湖", "罗湖区", "宝安", "宝安区", "龙岗", "龙岗区", "龙华", "龙华区", "坪山", "坪山区", "光明", "光明区", "盐田", "盐田区"]),
    ("广东", "广州市", ["天河", "天河区", "越秀", "越秀区", "海珠", "海珠区", "荔湾", "荔湾区", "黄埔", "黄埔区", "番禺", "番禺区", "花都", "花都区", "南沙", "南沙区", "从化", "从化区", "增城", "增城区"]),
    ("广东", "佛山市", ["禅城", "禅城区", "南海", "南海区", "顺德", "顺德区", "三水", "三水区", "高明", "高明区", "乐从", "乐从镇", "北滘", "北滘镇"]),
    ("广东", "东莞市", ["虎门", "虎门镇", "长安镇", "厚街", "厚街镇", "塘厦", "塘厦镇"]),
    ("广东", "惠州市", ["惠城", "惠城区", "惠阳", "惠阳区", "博罗", "博罗县", "惠东", "惠东县"]),
    ("广东", "汕头市", ["潮阳", "潮阳区", "潮南", "潮南区", "澄海", "澄海区"]),
    ("广东", "江门市", ["台山", "台山市", "开平", "开平市", "鹤山", "鹤山市", "恩平", "恩平市", "新会", "新会区"]),
    ("福建", "莆田市", ["荔城", "荔城区", "城厢", "城厢区", "涵江", "涵江区", "秀屿", "秀屿区", "仙游", "仙游县"]),
    ("福建", "厦门市", ["思明", "思明区", "湖里", "湖里区", "集美", "集美区", "海沧", "海沧区", "同安", "同安区", "翔安", "翔安区"]),
    ("福建", "泉州市", ["鲤城", "鲤城区", "丰泽", "丰泽区", "石狮", "石狮市", "晋江", "晋江市", "南安", "南安市", "惠安", "惠安县", "安溪", "安溪县"]),
    ("福建", "漳州市", ["芗城", "芗城区", "龙海", "龙海区", "漳浦", "漳浦县"]),
    ("福建", "福州市", ["仓山", "仓山区", "台江", "台江区", "晋安", "晋安区", "马尾", "马尾区", "长乐", "长乐区", "福清", "福清市", "闽侯", "闽侯县"]),
    ("山东", "青岛市", ["黄岛", "黄岛区", "崂山", "崂山区", "李沧", "李沧区", "城阳", "城阳区", "即墨", "即墨区", "胶州", "胶州市", "平度", "平度市", "莱西", "莱西市"]),
    ("山东", "济南市", ["历下", "历下区", "槐荫", "槐荫区", "天桥", "天桥区", "历城", "历城区", "章丘", "章丘区"]),
    ("山东", "潍坊市", ["奎文", "奎文区", "青州", "青州市", "诸城", "诸城市", "寿光", "寿光市", "高密", "高密市", "昌邑", "昌邑市"]),
    ("河南", "郑州市", ["中原", "中原区", "二七", "二七区", "管城", "管城区", "管城回族区", "金水", "金水区", "惠济", "惠济区", "中牟", "中牟县", "巩义", "巩义市", "荥阳", "荥阳市", "新郑", "新郑市", "登封", "登封市"]),
    ("湖南", "长沙市", ["芙蓉", "芙蓉区", "天心", "天心区", "岳麓", "岳麓区", "开福", "开福区", "雨花", "雨花区", "望城", "望城区", "长沙县", "浏阳", "浏阳市", "宁乡", "宁乡市"]),
    ("湖北", "武汉市", ["江岸", "江岸区", "江汉", "江汉区", "硚口", "硚口区", "汉阳", "汉阳区", "武昌", "武昌区", "洪山", "洪山区", "江夏", "江夏区", "黄陂", "黄陂区"]),
    ("四川", "成都市", ["锦江", "锦江区", "青羊", "青羊区", "金牛", "金牛区", "武侯", "武侯区", "成华", "成华区", "双流", "双流区", "郫都", "郫都区", "都江堰", "都江堰市", "简阳", "简阳市"]),
    ("陕西", "西安市", ["碑林", "碑林区", "莲湖", "莲湖区", "灞桥", "灞桥区", "未央", "未央区", "雁塔", "雁塔区", "长安区西", "高陵", "高陵区"]),
    ("上海", "上海市", ["黄浦", "黄浦区", "徐汇", "徐汇区", "静安", "静安区", "虹口", "虹口区", "杨浦", "杨浦区", "闵行", "闵行区", "宝山", "宝山区", "嘉定", "嘉定区", "浦东", "浦东新区", "松江", "松江区", "青浦", "青浦区", "奉贤", "奉贤区", "崇明", "崇明区", "金山", "金山区"]),
    ("北京", "北京市", ["东城", "东城区", "西城", "西城区", "朝阳区北", "丰台", "丰台区", "海淀", "海淀区", "通州", "通州区", "顺义", "顺义区", "昌平", "昌平区", "大兴", "大兴区"]),
]

AMBIGUOUS = {
    "高新区", "高新技术开发区", "经济开发区", "经济技术开发区", "开发区", "工业园", "工业园区",
    "新区", "新城", "城区", "郊区", "市区", "城关", "城关区", "东区", "西区", "南区", "北区",
    "白云区", "西湖区", "鼓楼区", "鼓楼", "铁西区", "铁东区", "新华区", "向阳区", "和平区",
    "长安区", "桥西区", "桥东区", "西安区", "海州区", "青山区", "市中区",
}

seen = {}
for prov, city_full, aliases in counties:
    for alias in aliases:
        a = alias.strip()
        if not a or a in AMBIGUOUS:
            continue
        if a in seen and seen[a] != (prov, city_full):
            seen[a] = None
            continue
        if seen.get(a) is None and a in seen:
            continue
        seen[a] = (prov, city_full)

unique = {k: v for k, v in seen.items() if v}
grouped = defaultdict(list)
for alias, key in unique.items():
    grouped[key].append(alias)

county_out = [{
    "province": prov,
    "city": city_full,
    "aliases": sorted(set(aliases), key=lambda x: (-len(x), x)),
} for (prov, city_full), aliases in grouped.items()]

data = {
    "version": "2026.10-offline-v1",
    "source": "全国省市表.xlsx (标准省/标准市) + unique county aliases",
    "provinces": list(provinces_map.values()),
    "cities": cities,
    "counties": county_out,
    "municipalities": ["北京", "天津", "上海", "重庆"],
    "ambiguous": sorted(AMBIGUOUS),
}

json_path = out_dir / "china_admin.json"
js_path = out_dir / "china_admin.js"
payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
json_path.write_text(payload, encoding="utf-8")
js_path.write_text("window.__pwChinaAdmin=" + payload + ";\n", encoding="utf-8")
print("provinces", len(provinces_map), "cities", len(cities), "county-groups", len(county_out))
print("json", json_path, json_path.stat().st_size)
print("js", js_path, js_path.stat().st_size)
