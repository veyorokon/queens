from PIL import Image, ImageDraw

GROUND = (21, 24, 30)
EDGE = (11, 14, 19)
CROWN = (246, 243, 234)
# three of the board hues, in the dark-theme tones the app uses
HUES = [(143,117,38),(52,97,143),(147,85,95),(63,124,78),(99,80,143),(143,87,38),(35,112,108),(110,102,84),(140,56,68),(65,71,147)]
CELLS = [[0,0,1],[2,3,1],[2,3,3]]   # a small three-colour board

def crown(d, x, y, w, h, fill):
    # five points down to a base bar, the same shape as the page glyph
    pts = [(x, y+0.28*h), (x+0.22*w, y+0.55*h), (x+0.5*w, y), (x+0.78*w, y+0.55*h), (x+w, y+0.28*h),
           (x+0.88*w, y+0.86*h), (x+0.12*w, y+0.86*h)]
    d.polygon(pts, fill=fill)
    d.rounded_rectangle([x+0.06*w, y+0.9*h, x+0.94*w, y+1.06*h], radius=0.07*h, fill=fill)

def build(size):
    s = 8   # supersample
    img = Image.new('RGB', (size*s, size*s), GROUND)
    d = ImageDraw.Draw(img)
    S = size*s
    pad = S*0.155
    board = S - 2*pad
    cell = board/3
    d.rounded_rectangle([pad-S*0.022, pad-S*0.022, pad+board+S*0.022, pad+board+S*0.022], radius=S*0.045, fill=EDGE)
    for r in range(3):
        for c in range(3):
            x0, y0 = pad + c*cell, pad + r*cell
            d.rectangle([x0+S*0.006, y0+S*0.006, x0+cell-S*0.006, y0+cell-S*0.006], fill=HUES[CELLS[r][c]])
    # one crown, sitting in the middle square
    cw = cell*0.62
    crown(d, pad+cell+ (cell-cw)/2, pad+cell+(cell-cw)/2*1.15, cw, cw*0.78, CROWN)
    return img.resize((size, size), Image.LANCZOS)

import sys, os
out = sys.argv[1]
for n in (180, 192, 512):
    p = os.path.join(out, 'icon-%d.png' % n)
    build(n).save(p)
    print('wrote', p, os.path.getsize(p), 'bytes')
