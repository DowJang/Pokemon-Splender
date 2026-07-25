"""PokeAPI 공식 아트웍 스프라이트를 app/assets/sprites 로 내려받는다.
개인용 오프라인 실행을 위한 1회성 스크립트."""
import os
import urllib.request

DEX = {
    # 퀵볼(yellow) 계열
    "nidoran-f": 29, "nidorina": 30, "nidoqueen": 31,
    "gastly": 92, "haunter": 93, "gengar": 94,
    "bulbasaur": 1, "ivysaur": 2, "venusaur": 3,
    # 몬스터볼(red) 계열
    "bellsprout": 69, "weepinbell": 70, "victreebel": 71,
    "machop": 66, "machoke": 67, "machamp": 68,
    "squirtle": 7, "wartortle": 8, "blastoise": 9,
    # 슈퍼볼(blue) 계열
    "pidgey": 16, "pidgeotto": 17, "pidgeot": 18,
    "geodude": 74, "graveler": 75, "golem": 76,
    "charmander": 4, "charmeleon": 5, "charizard": 6,
    # 힐볼(pink) 계열
    "poliwag": 60, "poliwhirl": 61, "poliwrath": 62,
    "caterpie": 10, "metapod": 11, "butterfree": 12,
    "abra": 63, "kadabra": 64, "alakazam": 65,
    # 하이퍼볼(black) 계열
    "oddish": 43, "gloom": 44, "vileplume": 45,
    "weedle": 13, "kakuna": 14, "beedrill": 15,
    "dratini": 147, "dragonair": 148, "dragonite": 149,
    # 희귀
    "lapras": 131, "aerodactyl": 142, "snorlax": 143,
    "eevee": 133, "ditto": 132,
    # 전설/환상
    "articuno": 144, "zapdos": 145, "moltres": 146,
    "mewtwo": 150, "mew": 151,
}

BASE = ("https://raw.githubusercontent.com/PokeAPI/sprites/master/"
        "sprites/pokemon/other/official-artwork/{}.png")

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "app", "assets", "sprites")


def main():
    os.makedirs(OUT, exist_ok=True)
    ok = fail = skip = 0
    for name, num in sorted(DEX.items(), key=lambda kv: kv[1]):
        dest = os.path.join(OUT, f"{num}.png")
        if os.path.exists(dest) and os.path.getsize(dest) > 1000:
            skip += 1
            continue
        try:
            req = urllib.request.Request(BASE.format(num),
                                         headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            ok += 1
            print(f"OK   {num:>3} {name}  ({len(data)//1024} KB)")
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"FAIL {num:>3} {name}: {e}")
    print(f"\ndone: {ok} downloaded, {skip} skipped, {fail} failed -> {OUT}")


if __name__ == "__main__":
    main()
