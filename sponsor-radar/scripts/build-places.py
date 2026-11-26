"""Builds sponsor-radar/data/places.json: rough coordinates for UK postcode districts and towns.

The app uses it on the phone to measure how far a role is from you. Nothing is sent anywhere.

Source: the ONS Postcode Directory and OS Open Names, bundled by the npm package uk-address-lookup.
Contains OS data (c) Crown copyright and database right, and Royal Mail data (c) Royal Mail copyright and database right.
Contains National Statistics data (c) Crown copyright and database right. Open Government Licence v3.0.

Run it again only when you want fresher data:
    npm pack uk-address-lookup && tar xzf uk-address-lookup-*.tgz
    python3 sponsor-radar/scripts/build-places.py package/data/uk-address.json.gz
"""
import collections, gzip, json, sys

MIN_POSTCODES = 20   # a town needs at least this many postcodes to be listed

# Places the source names differently or leaves out: counties, Northern Ireland, a few towns.
EXTRAS = {
    'berkshire': (51.45, -1.08), 'surrey': (51.25, -0.45), 'hampshire': (51.06, -1.31), 'hertfordshire': (51.8, -0.24),
    'kent': (51.22, 0.72), 'lancashire': (53.8, -2.6), 'oxfordshire': (51.76, -1.26), 'nottinghamshire': (53.1, -1.0),
    'gloucestershire': (51.85, -2.2), 'bedfordshire': (52.08, -0.45), 'leicestershire': (52.65, -1.2), 'merseyside': (53.42, -2.95),
    'cheshire': (53.2, -2.6), 'greater manchester': (53.5, -2.3), 'lanarkshire': (55.7, -3.9), 'essex': (51.77, 0.5),
    'norfolk': (52.65, 1.0), 'suffolk': (52.2, 1.0), 'devon': (50.7, -3.7), 'cornwall': (50.4, -4.9), 'somerset': (51.1, -3.0),
    'dorset': (50.75, -2.3), 'wiltshire': (51.3, -1.9), 'east sussex': (50.92, 0.25), 'west sussex': (51.0, -0.47),
    'west yorkshire': (53.75, -1.7), 'south yorkshire': (53.5, -1.35), 'north yorkshire': (54.1, -1.4), 'derbyshire': (53.1, -1.55),
    'staffordshire': (52.85, -2.0), 'warwickshire': (52.3, -1.5), 'west midlands': (52.48, -1.85), 'worcestershire': (52.2, -2.2),
    'herefordshire': (52.08, -2.7), 'shropshire': (52.65, -2.65), 'cumbria': (54.6, -3.0), 'northumberland': (55.3, -2.0),
    'county durham': (54.7, -1.55), 'tyne and wear': (54.97, -1.6), 'lincolnshire': (53.1, -0.2), 'northamptonshire': (52.3, -0.9),
    'cambridgeshire': (52.4, -0.1), 'buckinghamshire': (51.8, -0.8), 'rutland': (52.65, -0.63), 'isle of wight': (50.67, -1.3),
    'cardiff': (51.48, -3.18), 'belfast': (54.6, -5.93), 'hounslow': (51.47, -0.37), 'derry': (55.0, -7.31),
    'londonderry': (55.0, -7.31), 'northern ireland': (54.6, -6.7), 'greenwich': (51.48, 0.0), 'droitwich': (52.27, -2.15),
    'carmarthen': (51.86, -4.31), 'milford haven': (51.71, -5.04), 'bury st. edmunds': (52.25, 0.71), 'south croydon': (51.36, -0.09),
    'london': (51.51, -0.12),
}

src = sys.argv[1]
data = json.load(gzip.open(src))
towns, streets, postcodes = data['towns'], data['streets'], data['postcodes']
district = collections.defaultdict(lambda: [0.0, 0.0, 0])
town = collections.defaultdict(lambda: [0.0, 0.0, 0])
for pc, lat, lng, street_ids in postcodes:
    a = district[pc.split(' ')[0]]
    a[0] += lat; a[1] += lng; a[2] += 1
    if street_ids:
        ti = streets[street_ids[0]][1]
        if ti >= 0:
            b = town[towns[ti].lower()]
            b[0] += lat; b[1] += lng; b[2] += 1

d = {k: [round(v[0] / v[2], 2), round(v[1] / v[2], 2)] for k, v in sorted(district.items())}
t = {k: [round(v[0] / v[2], 2), round(v[1] / v[2], 2)] for k, v in sorted(town.items()) if v[2] >= MIN_POSTCODES}
for name, (lat, lng) in EXTRAS.items():
    t.setdefault(name, [lat, lng])
out = {
    'attribution': 'Contains OS data (c) Crown copyright and database right; Royal Mail data (c) Royal Mail copyright and database right; National Statistics data (c) Crown copyright and database right. Open Government Licence v3.0.',
    'd': d, 't': dict(sorted(t.items())),
}
json.dump(out, open('sponsor-radar/data/places.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(d), 'districts,', len(t), 'towns')
