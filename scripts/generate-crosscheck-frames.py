"""Reproducible SVG teaching frames, never experimental robot observations."""
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / "public" / "observations"


def frame(name, number, body, subtitle):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-label="Illustration: {subtitle}">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#b4cdcf"/><stop offset="1" stop-color="#e2ded0"/></linearGradient></defs>
    {body}
    <rect x="18" y="18" width="258" height="30" rx="4" fill="#17303a"/><text x="31" y="38" fill="#e8f3ef" font-family="monospace" font-size="14" letter-spacing="1">ILLUSTRATION · FRAME {number}</text>
    <rect x="0" y="456" width="800" height="44" fill="#122a34"/><text x="22" y="484" fill="#e0ece8" font-family="sans-serif" font-size="17">{subtitle}</text></svg>'''
    (DEST / f"crosscheck-{name}.svg").write_text(svg)


def tree(x, y, size=1):
    return f'<g transform="translate({x} {y}) scale({size})"><path d="M0 0v125" stroke="#64756a" stroke-width="12"/><ellipse cy="-8" rx="48" ry="64" fill="#718b74"/><ellipse cx="-15" cy="-24" rx="32" ry="40" fill="#8fa389"/></g>'


def exterior(letter="E", bicycle=False, woods=False):
    body = '<rect width="800" height="500" fill="url(#sky)"/><path d="M0 255 800 200v300H0Z" fill="#8d9f84"/><path d="M220 456 400 220h95L685 456Z" fill="#c8c4b0"/><path d="M310 456 443 228M250 414h390M299 350h285M345 290h190" stroke="#a3a994" stroke-width="2" fill="none"/>'
    if not woods:
        body += f'<path d="M468 80 790 37v280l-322-42Z" fill="#cbd0c5"/><path d="m490 105 280-32v77l-280 15Z" fill="#688087"/><path d="m500 188 263-3v72l-263-25Z" fill="#718e90"/><path d="M620 192h62v123l-62-8Z" fill="#364f57"/><path d="M650 195v114" stroke="#d1d7ca" stroke-width="3"/><rect x="596" y="147" width="44" height="40" rx="3" fill="#3b7490"/><text x="607" y="177" font-family="sans-serif" font-size="30" fill="#fff">{letter}</text>'
    body += tree(80, 205, 1.25) + tree(225, 196, .9) + tree(330, 207, .6)
    if woods:
        body += tree(630, 150, 1.6) + tree(755, 190, 1.25) + tree(495, 195, .6)
    if bicycle:
        body += '<g stroke="#354d56" stroke-width="7" fill="none"><circle cx="530" cy="365" r="42"/><circle cx="666" cy="365" r="42"/></g><path d="m530 365 42-69 43 69h-85l87-87 49 87m-49-87h30m-75 18h-24" stroke="#ba5c4e" stroke-width="9" stroke-linejoin="round" fill="none"/>'
    return body


def room(letter, content="none", alternate=False):
    body = '<rect width="800" height="500" fill="#a2b1af"/><path d="M0 0 210 110v240L0 456Z" fill="#bdc6bd"/><path d="M800 0 620 110v240l180 106Z" fill="#9aafaa"/><path d="M0 456 210 350h410l180 106Z" fill="#748985"/><path d="M0 0 210 110h410L800 0Z" fill="#e0e3d7"/><path d="M210 110h410v240H210Z" fill="#abbcb4"/><path d="M0 403h800M140 456l130-106M650 456 550 350" stroke="#a7b6aa" stroke-width="2"/><rect x="244" y="139" width="177" height="138" fill="#6f8d92" stroke="#dbe0d2" stroke-width="9"/><path d="M288 140v136M333 140v136M377 140v136" stroke="#dbe0d2" stroke-width="6"/>'
    body += f'<rect x="480" y="132" width="101" height="218" fill="#47636b" stroke="#d1d8cb" stroke-width="8"/><rect x="498" y="149" width="62" height="46" rx="3" fill="#3c7590"/><text x="516" y="184" fill="white" font-family="sans-serif" font-size="33">{letter}</text><circle cx="564" cy="270" r="4" fill="#c1cbbb"/>'
    if content != "none":
        body += '<path d="M150 332h400l95 57H92Z" fill="#d2d7c8"/><path d="M110 389v60M618 389v60" stroke="#3d5961" stroke-width="13"/><path d="M109 390h511v13H109Z" fill="#80938d"/>'
    if content in ("arm", "partial"):
        shift = 42 if alternate else 0
        body += f'<g transform="translate({shift} 0)"><ellipse cx="338" cy="344" rx="41" ry="13" fill="#3c5861"/><path d="M338 339v-61l-47-55 34-51 66 29" stroke="#d6ad62" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="291" cy="223" r="18" fill="#496770"/><circle cx="325" cy="172" r="16" fill="#496770"/><circle cx="391" cy="201" r="12" fill="#496770"/><path d="m396 207 18 22m-22-9 13 20 16-8m-15-23 20 13-7 18" stroke="#3c5661" stroke-width="8" fill="none"/></g>'
    if content == "lamp":
        body += '<ellipse cx="338" cy="344" rx="40" ry="11" fill="#3c5861"/><path d="M338 339v-63l-44-48 34-52 63 27" stroke="#baaa70" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="294" cy="228" r="11" fill="#4c676b"/><circle cx="328" cy="176" r="10" fill="#4c676b"/><path d="m383 191 17-10 43 49-63 23Z" fill="#647c7e"/><path d="m380 253 63-23-20 42Z" fill="#e8dfaa"/>'
    if content == "partial":
        body += '<path d="M356 190h115v150H356Z" fill="#7c9391" stroke="#bfd0c6" stroke-width="5"/><path d="M413 341v24" stroke="#425c63" stroke-width="8"/><path d="M388 366h50" stroke="#425c63" stroke-width="7"/>'
    if alternate:
        body += '<path d="M5 60 58 81v356L5 456Z" fill="#607c7d" opacity=".7"/>'
    return body


frame("bike_before", "012", exterior("W", True), "West gate · red bicycle · before the woods")
frame("woods", "042", exterior(woods=True), "Woodland segment · temporal anchor")
frame("bike_after", "068", exterior("E", True), "East entrance E · red bicycle · after the woods")
frame("west_entry", "075", exterior("W"), "Similar facade · W sign · different building")
frame("east_entry", "078", exterior("E"), "Entrance E · blue sign and adjacent path")
frame("lab_a", "092", room("A"), "Lab A · first visit · doorway and window anchor")
frame("lab_b", "105", room("B", "lamp"), "Lab B · second distinct lab · adjustable lamp")
frame("lab_a_return", "112", room("A", alternate=True), "Lab A again · same doorway · not a third lab")
frame("lab_c_front", "128", room("C", "partial"), "Lab C · partial view · object end is occluded")
frame("lab_c_side", "143", room("C", "arm", True), "Lab C · second view · joints and gripper visible")
