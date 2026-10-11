"""Refresh the public Numbeo rankings snapshot: uv run python numbeo/update_data.py."""
import argparse
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

SOURCE = 'https://www.numbeo.com/quality-of-life/rankings.jsp'
GROUPS = {
    'Europe': 'Albania|Austria|Belgium|Bosnia And Herzegovina|Bulgaria|Croatia|Cyprus|Czech Republic|Denmark|Estonia|Finland|France|Germany|Greece|Hungary|Iceland|Ireland|Italy|Latvia|Lithuania|Luxembourg|Netherlands|North Macedonia|Norway|Poland|Portugal|Romania|Serbia|Slovakia|Slovenia|Spain|Sweden|Switzerland|United Kingdom',
    'CIS': 'Armenia|Azerbaijan|Belarus|Georgia|Kazakhstan|Moldova|Russia|Ukraine|Uzbekistan',
    'Gulf / Israel / Turkey': 'Bahrain|Israel|Kuwait|Oman|Qatar|Saudi Arabia|Turkey|United Arab Emirates',
    'North America': 'Canada|United States',
    'Asia / Pacific': 'Australia|Bangladesh|China|Hong Kong (China)|India|Indonesia|Iran|Japan|Jordan|Lebanon|Malaysia|Nepal|New Zealand|Pakistan|Philippines|Singapore|South Korea|Sri Lanka|Taiwan|Thailand|Vietnam',
    'Latam / Africa': 'Argentina|Brazil|Chile|Colombia|Costa Rica|Dominican Republic|Ecuador|Egypt|Kenya|Mexico|Morocco|Namibia|Nigeria|Panama|Peru|Puerto Rico|South Africa|Tunisia|Uruguay|Venezuela',
}


def parse(document):
    body = document.split('<tbody>')[1].split('</tbody>')[0]
    countries = {country: group for group, names in GROUPS.items() for country in names.split('|')}
    cities = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S):
        cells = [html.unescape(re.sub('<[^>]+>', '', cell)).strip() for cell in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) != 11:
            raise ValueError('Numbeo table format changed')
        city, country = cells[1].rsplit(', ', 1)
        values = dict(zip(['quality', 'purchasingPower', 'safety', 'healthcare', 'cost', 'housing', 'commute', 'pollution', 'climate'], map(float, cells[2:])))
        # Reference removes all three price-linked terms from Numbeo's formula.
        values['nonPriceQuality'] = (100 + values['safety'] / 2 + values['healthcare'] / 2.5
                                     - values['commute'] / 2 - values['pollution'] * 2 / 3
                                     + values['climate'] / 3)
        cities.append(dict(city=city, country=country, region=countries[country], **values))
    if len(cities) < 100:
        raise ValueError('Unexpectedly few cities')
    title = html.unescape(re.search(r'<title>(.*?)</title>', document, re.S)[1])
    return dict(source=SOURCE, edition=title.replace('Quality of Life Index by City ', ''), fetchedAt=datetime.now(timezone.utc).isoformat(), cities=cities)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, help='Read a previously downloaded page instead')
    args = parser.parse_args()
    document = args.html.read_text() if args.html else urlopen(Request(SOURCE, headers={'User-Agent': 'Mozilla/5.0'}), timeout=40).read().decode('utf-8')
    data = parse(document)
    Path(__file__).with_name('data.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f"Saved {len(data['cities'])} cities ({data['edition']})")
