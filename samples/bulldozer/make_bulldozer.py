r"""デモ用のブルドーザー（特定製品ではない一般形）・細部作り込み版。
使い方（アプリのフォルダで、変換ツールの Python を使う）:
    converter\.venv\Scripts\python samples\bulldozer\make_bulldozer.py SampleBulldozerFull.step
できた STEP を変換ツールで .glb にする。
座標: X=前, Y=左右, Z=上 (mm)。最後に全体を X軸まわり -90度 回して Y上 にする"""
import math
import sys

import cadquery as cq

LS = 2800           # 起動輪と遊動輪の中心間距離
R = 430             # 履帯の曲がり半径
ZC = R + 60         # 起動輪・遊動輪の中心の高さ
TRACK_Y = 1000      # 履帯中心の左右位置
SHOE_W = 560
PITCH_TARGET = 190
LINK_Y = 200        # リンクの左右位置（履帯中心から）

COL = {
    "body": cq.Color(0.96, 0.70, 0.08),
    "dark": cq.Color(0.13, 0.13, 0.14),
    "steel": cq.Color(0.55, 0.56, 0.58),
    "bright": cq.Color(0.82, 0.83, 0.85),
    "bolt": cq.Color(0.32, 0.32, 0.34),
    "glass": cq.Color(0.55, 0.70, 0.80),
    "rubber": cq.Color(0.06, 0.06, 0.06),
    "seat": cq.Color(0.20, 0.20, 0.22),
    "lens": cq.Color(0.98, 0.95, 0.80),
    "red": cq.Color(0.85, 0.12, 0.10),
    "amber": cq.Color(1.00, 0.55, 0.05),
    "hose": cq.Color(0.08, 0.08, 0.09),
    "fitting": cq.Color(0.75, 0.62, 0.30),
    "green": cq.Color(0.15, 0.70, 0.25),
}


# ---------------- 形の部品 ----------------
def box(x, y, z):
    return cq.Workplane("XY").box(x, y, z)


def rbox(x, y, z, r):
    """角を丸めた箱"""
    return box(x, y, z).edges().fillet(r)


def at(wp, x, y, z):
    return wp.translate((x, y, z))


def cyl_y(r, length):
    return cq.Workplane("XZ").circle(r).extrude(length / 2, both=True)


def cyl_x(r, length):
    return cq.Workplane("YZ").circle(r).extrude(length / 2, both=True)


def cyl_z(r, length):
    return cq.Workplane("XY").circle(r).extrude(length / 2, both=True)


def ring_y(ro, ri, length):
    return cyl_y(ro, length).cut(cyl_y(ri, length + 2))


def rod(p1, p2, r):
    v = cq.Vector(*p2) - cq.Vector(*p1)
    return cq.Solid.makeCylinder(r, v.Length, cq.Vector(*p1), v)


def lerp(p1, p2, t):
    return tuple(p1[i] + (p2[i] - p1[i]) * t for i in range(3))


def beam(p1, p2, wy, h, r=0):
    """XZ面内で p1→p2 に伸びる角材（Y位置は p1 のもの）"""
    dx, dz = p2[0] - p1[0], p2[2] - p1[2]
    length = math.hypot(dx, dz)
    ang = math.degrees(math.atan2(-dz, dx))
    b = rbox(length, wy, h, r) if r else box(length, wy, h)
    return b.rotate((0, 0, 0), (0, 1, 0), ang).translate(lerp(p1, p2, 0.5))


def hose(points, r):
    vs = [cq.Vector(*p) for p in points]
    t0, t1 = vs[1] - vs[0], vs[-1] - vs[-2]
    path = cq.Workplane("XY").spline(vs, tangents=[t0, t1], includeCurrent=False)
    up = cq.Vector(0, 0, 1) if abs(t0.normalized().z) < 0.9 else cq.Vector(1, 0, 0)
    plane = cq.Plane(origin=vs[0], xDir=t0.cross(up), normal=t0)
    return cq.Workplane(plane).circle(r).sweep(path)


def hex_prism(af, h):
    return cq.Workplane("XY").polygon(6, af / math.cos(math.pi / 6)).extrude(h)


def bolt_z(af, head_h, d, length):
    """頭の下面が原点。頭は -Z 側、ねじ部は +Z 側へ伸びる"""
    head = hex_prism(af, head_h).faces(">Z").edges().chamfer(1.2).translate((0, 0, -head_h))
    return head.union(cq.Workplane("XY").circle(d / 2).extrude(length))


def nut_z(af, h, d):
    """下面が原点、+Z 側へ"""
    return hex_prism(af, h).faces(">Z").edges().chamfer(1.2).faces(">Z").workplane().hole(d)


def washer_z(od, idia, t):
    return cq.Workplane("XY").circle(od / 2).circle(idia / 2).extrude(t)


def nipple_z():
    """グリスニップル（給油口）。下面が原点で +Z 向き"""
    return (hex_prism(12, 6).union(cq.Workplane("XY").circle(3).extrude(14))
            .union(cq.Workplane("XY").sphere(5).translate((0, 0, 16))))


def beam_yz(p1, p2, wx, h):
    """YZ面内で p1→p2 に伸びる平たい帯（ベルト用。X位置は p1 のもの）"""
    dy, dz = p2[1] - p1[1], p2[2] - p1[2]
    length = math.hypot(dy, dz)
    ang = math.degrees(math.atan2(dz, dy))
    return box(wx, length, h).rotate((0, 0, 0), (1, 0, 0), ang).translate(lerp(p1, p2, 0.5))


def to_axis(wp, axis, sign=1):
    """Z軸向きに作った形を、X または Y 軸向き（sign で向き）に回す"""
    if axis == "x":
        return wp.rotate((0, 0, 0), (0, 1, 0), 90 * sign)
    return wp.rotate((0, 0, 0), (1, 0, 0), -90 * sign)


# ---------------- 履帯 ----------------
def track_path():
    perim = 2 * LS + 2 * math.pi * R
    n = round(perim / PITCH_TARGET)
    pitch = perim / n

    def point(s):
        s %= perim
        if s < LS:
            return (-LS / 2 + s, ZC - R, 0.0, -1.0)
        s -= LS
        if s < math.pi * R:
            a = -math.pi / 2 + s / R
            return (LS / 2 + R * math.cos(a), ZC + R * math.sin(a), math.cos(a), math.sin(a))
        s -= math.pi * R
        if s < LS:
            return (LS / 2 - s, ZC + R, 0.0, 1.0)
        s -= LS
        a = math.pi / 2 + s / R
        return (-LS / 2 + R * math.cos(a), ZC + R * math.sin(a), math.cos(a), math.sin(a))

    return n, pitch, point


def shoe_shape(pitch):
    """履板：端を面取りした板＋台形の爪（局所座標で -Z が地面側）"""
    plate = box(pitch - 8, SHOE_W, 20).edges("|Y").chamfer(4)
    g = (cq.Workplane("XZ").polyline([(-32, -10), (32, -10), (12, -52), (-12, -52)]).close()
         .extrude(SHOE_W / 2, both=True))
    return plate.union(g).edges("|X").chamfer(3)


def sprocket_segments():
    """起動輪の歯：滑らかな歯形の輪を3分割した部品"""
    teeth, tip, root = 11, R - 30, R - 92
    n_sub = 16
    pts = []
    for k in range(teeth * n_sub):
        frac = (k % n_sub) / n_sub
        r = root + (tip - root) * min(1.0, 1.5 * math.sin(math.pi * frac))
        a = 2 * math.pi * k / (teeth * n_sub)
        pts.append((r * math.cos(a), r * math.sin(a)))
    ring = cq.Workplane("XZ").polyline(pts).close().extrude(45, both=True)
    ring = ring.cut(cq.Workplane("XZ").circle(230).extrude(60, both=True))
    segs = []
    for s in range(3):
        a0 = 120 * s + 0.5
        wpts = [(0, 0)] + [(700 * math.cos(math.radians(a)), 700 * math.sin(math.radians(a)))
                           for a in [a0 + i * 11.9 for i in range(11)]]
        wedge = cq.Workplane("XZ").polyline(wpts).close().extrude(60, both=True)
        segs.append(ring.intersect(wedge))
    return segs


def track_side(side: str, sy: int) -> cq.Assembly:
    p = f"Trk{side}"
    a = cq.Assembly(name=f"Undercarriage{side}")
    ty = sy * TRACK_Y
    n, pitch, point = track_path()

    shoe = shoe_shape(pitch)
    link = (cq.Workplane("XZ").slot2D(pitch + 34, 92).extrude(20, both=True)
            .faces(">Y").workplane().pushPoints([(-pitch / 2, 0), (pitch / 2, 0)]).hole(46))
    pin = cyl_y(22, 480).faces("<Y or >Y").edges().chamfer(3)
    bush = cyl_y(36, 330)
    bolt = bolt_z(24, 12, 16, 140)
    nut = nut_z(24, 14, 16)
    washer = washer_z(34, 17, 4)

    def place(cx, cz, th, lx, ly, lz):
        t = math.radians(th)
        return (cx + lx * math.cos(t) + lz * math.sin(t), ty + ly,
                cz - lx * math.sin(t) + lz * math.cos(t))

    for i in range(n):
        x, z, nx, nz = point(i * pitch + pitch / 2)
        th = math.degrees(math.atan2(-nx, -nz))
        cx, cz = x + nx * 10, z + nz * 10
        q = f"{p}_Shoe{i + 1:02d}"
        rot = ((0, 1, 0), th)
        a.add(shoe, name=q, loc=cq.Location((cx, ty, cz), *rot), color=COL["dark"])
        # リンクは実物のように内側・外側を互い違いにする
        stagger = 18 if i % 2 == 0 else -18
        for j, ly in enumerate((-LINK_Y - stagger, LINK_Y + stagger), 1):
            a.add(link, name=f"{q}_Link{j}", loc=cq.Location(place(cx, cz, th, 0, ly, 65), *rot), color=COL["steel"])
        k = 0
        for lx in (-50, 50):
            for ly in (-LINK_Y, LINK_Y):
                k += 1
                a.add(bolt, name=f"{q}_Bolt{k}", loc=cq.Location(place(cx, cz, th, lx, ly, -10), *rot), color=COL["bolt"])
                a.add(washer, name=f"{q}_Washer{k}", loc=cq.Location(place(cx, cz, th, lx, ly, 111), *rot), color=COL["bright"])
                a.add(nut, name=f"{q}_Nut{k}", loc=cq.Location(place(cx, cz, th, lx, ly, 115), *rot), color=COL["bolt"])
        jx, jz, jnx, jnz = point((i + 1) * pitch)
        pp = (jx - jnx * 55, ty, jz - jnz * 55)
        a.add(pin, name=f"{p}_Pin{i + 1:02d}", loc=cq.Location(pp), color=COL["bright"])
        a.add(bush, name=f"{p}_Bushing{i + 1:02d}", loc=cq.Location(pp), color=COL["steel"])
        for j, ry in enumerate((-232, 232), 1):
            a.add(ring_y(28, 22, 8), name=f"{p}_PinRing{i + 1:02d}_{j}", loc=cq.Location((pp[0], ty + ry, pp[2])), color=COL["bright"])

    # 起動輪（3分割の歯＋ハブ＋ボルト）
    sx = -LS / 2
    for s, seg in enumerate(sprocket_segments(), 1):
        a.add(seg, name=f"{p}_SprocketSegment{s}", loc=cq.Location((sx, ty, ZC)), color=COL["dark"])
    hub = cyl_y(250, 120).faces("<Y or >Y").edges().chamfer(10)
    a.add(hub, name=f"{p}_SprocketHub", loc=cq.Location((sx, ty + sy * 20, ZC)), color=COL["steel"])
    a.add(cyl_y(140, 40).faces("<Y or >Y").edges().fillet(8), name=f"{p}_SprocketCap", loc=cq.Location((sx, ty + sy * 100, ZC)), color=COL["steel"])
    sbolt = to_axis(bolt_z(22, 11, 14, 60), "y", -sy)
    snut = to_axis(nut_z(22, 12, 14), "y", -sy)
    for k in range(15):
        ang = 2 * math.pi * k / 15 + 0.2
        bx, bz = sx + 270 * math.cos(ang), ZC + 270 * math.sin(ang)
        a.add(sbolt, name=f"{p}_SegmentBolt{k + 1:02d}", loc=cq.Location((bx, ty + sy * 48, bz)), color=COL["bolt"])
        a.add(snut, name=f"{p}_SegmentNut{k + 1:02d}", loc=cq.Location((bx, ty - sy * 48, bz)), color=COL["bolt"])
    for k in range(8):
        ang = 2 * math.pi * k / 8
        bx, bz = sx + 105 * math.cos(ang), ZC + 105 * math.sin(ang)
        a.add(to_axis(bolt_z(19, 10, 12, 30), "y", -sy), name=f"{p}_CapBolt{k + 1}", loc=cq.Location((bx, ty + sy * 122, bz)), color=COL["bolt"])
    fd = cyl_y(270, 300).faces("<Y or >Y").edges().fillet(25)
    a.add(fd, name=f"{p}_FinalDrive", loc=cq.Location((sx, ty - sy * 230, ZC)), color=COL["body"])
    for k in range(12):
        ang = 2 * math.pi * k / 12
        a.add(to_axis(bolt_z(19, 10, 12, 30), "y", sy), name=f"{p}_FinalDriveBolt{k + 1:02d}",
              loc=cq.Location((sx + 240 * math.cos(ang), ty - sy * 82, ZC + 240 * math.sin(ang))), color=COL["bolt"])

    # 遊動輪（リム・中央つば・肉抜き穴のあるウェブ・ハブ）
    ix = LS / 2
    rim = ring_y(R - 92, R - 160, 210).union(ring_y(R - 62, R - 120, 50)).edges().fillet(4)
    web = cyl_y(R - 150, 40)
    for k in range(6):
        ang = 2 * math.pi * k / 6
        web = web.cut(at(cyl_y(55, 60), 190 * math.cos(ang), 0, 190 * math.sin(ang)))
    a.add(rim, name=f"{p}_IdlerRim", loc=cq.Location((ix, ty, ZC)), color=COL["steel"])
    a.add(web, name=f"{p}_IdlerWeb", loc=cq.Location((ix, ty, ZC)), color=COL["steel"])
    a.add(cyl_y(110, 240).faces("<Y or >Y").edges().chamfer(8), name=f"{p}_IdlerHub", loc=cq.Location((ix, ty, ZC)), color=COL["steel"])
    for k in range(6):
        ang = 2 * math.pi * k / 6 + math.pi / 6
        a.add(to_axis(bolt_z(19, 10, 12, 30), "y", -sy), name=f"{p}_IdlerBolt{k + 1}",
              loc=cq.Location((ix + 80 * math.cos(ang), ty + sy * 122, ZC + 80 * math.sin(ang))), color=COL["bolt"])
    a.add(box(70, 300, 160).edges("|Y").fillet(10), name=f"{p}_IdlerYoke", loc=cq.Location((ix - 230, ty, ZC)), color=COL["body"])

    # 履帯フレーム・緩衝ばね
    tf = box(LS - 500, 260, 300).edges("|X").chamfer(30)
    a.add(tf, name=f"{p}_TrackFrame", loc=cq.Location((0, ty, ZC)), color=COL["body"])
    a.add(rbox(900, 300, 220, 20), name=f"{p}_RecoilCover", loc=cq.Location((LS / 2 - 750, ty, ZC + 40)), color=COL["body"])
    for k in range(6):
        a.add(to_axis(bolt_z(19, 10, 12, 30), "y", -sy), name=f"{p}_RecoilCoverBolt{k + 1}",
              loc=cq.Location((LS / 2 - 1150 + k * 160, ty + sy * 150, ZC + 120)), color=COL["bolt"])
    # 履帯ガイド（下転輪の間のガード）
    a.add(box(LS - 900, 40, 120).edges("|X").chamfer(8), name=f"{p}_TrackGuideIn", loc=cq.Location((0, ty - 140, ZC - R + 230)), color=COL["body"])
    a.add(box(LS - 900, 40, 120).edges("|X").chamfer(8), name=f"{p}_TrackGuideOut", loc=cq.Location((0, ty + 140, ZC - R + 230)), color=COL["body"])

    # 下転輪 7個
    roller = (cyl_y(100, 200).union(cyl_y(126, 30).translate((0, -85, 0))).union(cyl_y(126, 30).translate((0, 85, 0)))
              .edges().fillet(4))
    cap = cyl_y(58, 40).faces("<Y or >Y").edges().chamfer(5)
    cbolt = to_axis(bolt_z(17, 9, 10, 25), "y", -sy)
    roller_z = ZC - R + 160
    for k in range(7):
        rx = -LS / 2 + 500 + k * (LS - 1000) / 6
        q = f"{p}_TrackRoller{k + 1}"
        a.add(roller, name=q, loc=cq.Location((rx, ty, roller_z)), color=COL["steel"])
        a.add(cap, name=f"{q}_CapIn", loc=cq.Location((rx, ty - 120, roller_z)), color=COL["bolt"])
        a.add(cap, name=f"{q}_CapOut", loc=cq.Location((rx, ty + 120, roller_z)), color=COL["bolt"])
        a.add(to_axis(nipple_z(), "y", sy), name=f"{q}_GreaseNipple", loc=cq.Location((rx, ty + sy * 140, roller_z)), color=COL["fitting"])
        for j in range(4):
            ang = math.pi / 4 + j * math.pi / 2
            a.add(cbolt, name=f"{q}_CapBolt{j + 1}",
                  loc=cq.Location((rx + 38 * math.cos(ang), ty + sy * 140, roller_z + 38 * math.sin(ang))), color=COL["bolt"])
    # 上転輪 2個
    carrier_z = ZC + R - 165
    for k, rx in enumerate((-500, 600), 1):
        q = f"{p}_CarrierRoller{k}"
        a.add(cyl_y(80, 180).edges().fillet(6), name=q, loc=cq.Location((rx, ty, carrier_z)), color=COL["steel"])
        a.add(rbox(120, 60, 160, 8), name=f"{q}_Bracket", loc=cq.Location((rx, ty - sy * 150, carrier_z - 60)), color=COL["body"])
        a.add(cyl_y(30, 90), name=f"{q}_Axle", loc=cq.Location((rx, ty - sy * 120, carrier_z)), color=COL["bright"])
    # 泥よけと支え
    a.add(box(LS + 400, SHOE_W + 40, 12).edges("|Z").fillet(30), name=f"{p}_Fender", loc=cq.Location((0, ty, ZC + R + 140)), color=COL["body"])
    a.add(box(LS + 400, 12, 80), name=f"{p}_FenderLip", loc=cq.Location((0, ty + sy * (SHOE_W / 2 + 14), ZC + R + 100)), color=COL["body"])
    fbolt = bolt_z(17, 9, 10, 20).rotate((0, 0, 0), (1, 0, 0), 180)
    for k in range(12):
        for j, dy in enumerate((-SHOE_W / 2 + 20, SHOE_W / 2 - 20), 1):
            a.add(fbolt, name=f"{p}_FenderBolt{k + 1:02d}_{j}", loc=cq.Location((-LS / 2 - 50 + k * 260, ty + dy, ZC + R + 146)), color=COL["bolt"])
    a.add(to_axis(nipple_z(), "y", sy), name=f"{p}_IdlerNipple", loc=cq.Location((ix, ty + sy * 122, ZC)), color=COL["fitting"])
    for k in range(4):
        a.add(box(40, 12, 120), name=f"{p}_FenderStay{k + 1}", loc=cq.Location((-1200 + k * 800, ty - sy * (SHOE_W / 2 - 20), ZC + R + 80)), color=COL["body"])
    return a


# ---------------- 車体 ----------------
def body() -> cq.Assembly:
    a = cq.Assembly(name="Body")
    Y = COL["body"]
    a.add(box(3800, 1360, 500).edges("|X").chamfer(40), name="MainFrame", loc=cq.Location((0, 0, 700)), color=COL["dark"])
    # フードは中空（下が開いた殻）。フードを隠すと中のエンジンが見える
    hood = box(1900, 1200, 800).edges("|X and >Z").chamfer(150).edges("|Z").fillet(20).faces("<Z").shell(-10)
    a.add(hood, name="EngineHood", loc=cq.Location((1150, 0, 1350)), color=Y)
    mesh = (cq.Workplane("YZ").rect(1000, 640).extrude(4).faces(">X").workplane()
            .rarray(40, 40, 22, 14).rect(28, 28).cutThruAll())
    a.add(mesh, name="RadiatorGuardMesh", loc=cq.Location((2085, 0, 1320)), color=COL["dark"])
    # イコライザーバー（左右の履帯フレームをつなぐ横棒）と前の牽引フック
    a.add(rbox(220, 2 * TRACK_Y, 130, 20), name="EqualizerBar", loc=cq.Location((700, 0, 360)), color=COL["dark"])
    a.add(cyl_x(70, 300), name="EqualizerPivot", loc=cq.Location((700, 0, 360)), color=COL["steel"])
    for side, sy in (("L", -1), ("R", 1)):
        a.add(cyl_y(45, 120), name=f"EqualizerEndPin{side}", loc=cq.Location((700, sy * (TRACK_Y - 60), 360)), color=COL["bright"])
        a.add(to_axis(nipple_z(), "y", sy), name=f"EqualizerNipple{side}", loc=cq.Location((700, sy * (TRACK_Y), 360)), color=COL["fitting"])
    hook = (cq.Workplane("XZ").moveTo(0, 0).lineTo(120, 0).threePointArc((200, 80), (120, 160)).lineTo(90, 160)
            .lineTo(90, 110).threePointArc((130, 80), (90, 50)).lineTo(0, 50).close().extrude(30, both=True))
    a.add(hook, name="TowHook", loc=cq.Location((1900, 0, 480)), color=COL["red"])
    a.add(rbox(1500, 1000, 40, 8), name="HoodTopHatch", loc=cq.Location((1150, 0, 1770)), color=Y)
    for k, hx in enumerate((600, 1700), 1):
        a.add(cyl_y(25, 120), name=f"HatchHinge{k}", loc=cq.Location((hx, -480, 1795)), color=COL["steel"])
    a.add(box(80, 60, 20), name="HatchLatch", loc=cq.Location((1150, 480, 1795)), color=COL["dark"])
    eye = (cq.Workplane("XZ").rect(70, 70).extrude(10, both=True).edges("|Y and >Z").fillet(30)
           .faces(">Y").workplane().hole(30))
    for k, (ex, ey) in enumerate([(450, -450), (450, 450), (1850, -450), (1850, 450)], 1):
        a.add(eye, name=f"LiftEye{k}", loc=cq.Location((ex, ey, 1820)), color=Y)

    # ラジエーターグリル
    a.add(rbox(60, 1100, 700, 10), name="GrilleFrame", loc=cq.Location((2120, 0, 1320)), color=Y)
    for k in range(14):
        a.add(rbox(30, 1000, 22, 4), name=f"GrilleSlat{k + 1:02d}", loc=cq.Location((2160, 0, 1030 + k * 44)), color=COL["dark"])
    for k, gy in enumerate((-350, 0, 350), 1):
        a.add(box(36, 30, 640), name=f"GrilleBar{k}", loc=cq.Location((2175, gy, 1320)), color=Y)
    for k, (gy, gz) in enumerate([(-520, 1000), (520, 1000), (-520, 1640), (520, 1640)], 1):
        a.add(to_axis(bolt_z(19, 10, 12, 30), "x", -1), name=f"GrilleBolt{k}", loc=cq.Location((2152, gy, gz)), color=COL["bolt"])
    # 前照灯
    for side, sy in (("L", -1), ("R", 1)):
        a.add(cyl_x(70, 100).faces(">X").edges().fillet(8), name=f"HeadLamp{side}", loc=cq.Location((2150, sy * 470, 1750)), color=COL["dark"])
        a.add(cyl_x(58, 8), name=f"HeadLamp{side}_Lens", loc=cq.Location((2202, sy * 470, 1750)), color=COL["lens"])
        a.add(cyl_x(72, 12).cut(cyl_x(60, 14)), name=f"HeadLamp{side}_Bezel", loc=cq.Location((2205, sy * 470, 1750)), color=COL["bright"])

    for side, sy in (("L", -1), ("R", 1)):
        # 点検扉（2枚）・ヒンジ・ロック
        for d, dx in enumerate((650, 1450), 1):
            dq = f"SideDoor{side}{d}"
            a.add(rbox(700, 12, 520, 4), name=dq, loc=cq.Location((dx, sy * 606, 1300)), color=Y)
            for k in range(7):
                a.add(box(500, 6, 18).edges("|Y").fillet(2.5), name=f"{dq}_Louver{k + 1}", loc=cq.Location((dx + 40, sy * 614, 1140 + k * 50)), color=COL["dark"])
            for k, hz in enumerate((1120, 1480), 1):
                a.add(cyl_z(14, 90), name=f"{dq}_Hinge{k}", loc=cq.Location((dx - 365, sy * 615, hz)), color=COL["steel"])
            a.add(rbox(60, 20, 30, 4), name=f"{dq}_Lock", loc=cq.Location((dx + 300, sy * 620, 1300)), color=COL["dark"])
        a.add(box(1900, 50, 40).edges("|X").fillet(10), name=f"HoodHandrail{side}", loc=cq.Location((1150, sy * 630, 1830)), color=COL["steel"])
        for k, hx in enumerate((300, 1150, 2000), 1):
            a.add(cyl_z(15, 90), name=f"HandrailPost{side}{k}", loc=cq.Location((hx, sy * 630, 1775)), color=COL["steel"])
    # 排気管・プレクリーナー
    a.add(cyl_z(70, 900), name="ExhaustStack", loc=cq.Location((1500, 300, 2200)), color=COL["dark"])
    a.add(cyl_z(90, 120).faces(">Z").edges().fillet(10), name="ExhaustCollar", loc=cq.Location((1500, 300, 1810)), color=COL["dark"])
    a.add(box(180, 160, 6).rotate((0, 0, 0), (0, 1, 0), 20), name="ExhaustRainCap", loc=cq.Location((1500, 300, 2670)), color=COL["dark"])
    a.add(cyl_z(110, 400), name="PrecleanerBody", loc=cq.Location((1200, -300, 1990)), color=COL["dark"])
    a.add(cyl_z(140, 80).faces(">Z").edges().fillet(30), name="PrecleanerCap", loc=cq.Location((1200, -300, 2230)), color=COL["dark"])
    a.add(cyl_z(100, 120), name="PrecleanerBowl", loc=cq.Location((1200, -300, 2080)), color=COL["glass"])
    # 燃料タンク・作動油タンク
    a.add(rbox(450, 1300, 600, 50), name="FuelTank", loc=cq.Location((-1750, 0, 1250)), color=Y)
    a.add(cyl_z(60, 40).faces(">Z").edges().fillet(10), name="FuelCap", loc=cq.Location((-1750, 400, 1570)), color=COL["dark"])
    a.add(box(10, 80, 300), name="FuelGauge", loc=cq.Location((-1980, -400, 1250)), color=COL["glass"])
    a.add(rbox(400, 400, 500, 25), name="HydraulicTank", loc=cq.Location((-1250, 500, 1200)), color=Y)
    a.add(cyl_z(45, 40), name="HydraulicFiller", loc=cq.Location((-1250, 500, 1470)), color=COL["dark"])
    a.add(cyl_x(30, 20), name="HydraulicSightGlass", loc=cq.Location((-1040, 500, 1150)), color=COL["glass"])
    # ステップ（滑り止め穴）と手すり
    step = box(300, 220, 10).faces(">Z").workplane().rarray(40, 40, 6, 4).hole(16)
    for k in range(3):
        a.add(step, name=f"Step{k + 1}", loc=cq.Location((-800, -1350, 300 + k * 300)), color=COL["steel"])
        a.add(box(300, 10, 60), name=f"StepKick{k + 1}", loc=cq.Location((-800, -1460, 280 + k * 300)), color=COL["steel"])
    a.add(rbox(40, 40, 900, 8), name="StepRail", loc=cq.Location((-650, -1350, 600)), color=COL["steel"])
    # 乗り降り用の手すり（後ろの柱の外側、ドアにかからない位置）
    a.add(hose([(-1520, -700, 1100), (-1560, -740, 1400), (-1560, -740, 2100), (-1520, -700, 2400)], 18), name="Grabrail", color=COL["amber"])
    # 後部の牽引ピンとカウンター
    a.add(cyl_z(40, 300), name="DrawbarPin", loc=cq.Location((-1950, 0, 700)), color=COL["bright"])
    return a


def cab() -> cq.Assembly:
    a = cq.Assembly(name="Cab")
    Y = COL["body"]
    x0, x1, z0, z1 = -1450, 50, 1000, 2800
    xm, zm = (x0 + x1) / 2, (z0 + z1) / 2
    a.add(box(x1 - x0 + 100, 1400, 40), name="CabFloor", loc=cq.Location((xm, 0, z0)), color=COL["dark"])
    a.add(box(x1 - x0 - 100, 1200, 10), name="FloorMat", loc=cq.Location((xm, 0, z0 + 25)), color=COL["rubber"])
    for k, (px, py) in enumerate([(x0, -650), (x0, 650), (x1, -650), (x1, 650)], 1):
        a.add(rbox(90, 90, z1 - z0, 15), name=f"Pillar{k}", loc=cq.Location((px, py, zm)), color=Y)
    # 屋根は左右方向に丸みを持たせる
    roof = (cq.Workplane("YZ").moveTo(-775, 0).lineTo(775, 0).lineTo(775, 60)
            .threePointArc((0, 150), (-775, 60)).close().extrude((x1 - x0 + 300) / 2, both=True)
            .edges("|Y").fillet(25))
    a.add(roof, name="Roof", loc=cq.Location((xm, 0, z1)), color=Y)
    a.add(rbox(260, 1300, 14, 5).rotate((0, 0, 0), (0, 1, 0), 12), name="RainVisor", loc=cq.Location((x1 + 170, 0, z1 - 10)), color=Y)
    a.add(rbox(20, 700, 180, 8), name="SunVisor", loc=cq.Location((x1 - 60, -150, z1 - 140)), color=COL["seat"])
    a.add(rbox(x1 - x0 - 150, 1150, 10, 4), name="Headliner", loc=cq.Location((xm, 0, z1 - 15)), color=cq.Color(0.75, 0.75, 0.72))
    a.add(box(x1 - x0 + 250, 30, 30).edges("|X").fillet(8), name="DripRailL", loc=cq.Location((xm, -760, z1 + 10)), color=Y)
    a.add(box(x1 - x0 + 250, 30, 30).edges("|X").fillet(8), name="DripRailR", loc=cq.Location((xm, 760, z1 + 10)), color=Y)
    a.add(cyl_z(8, 400), name="Antenna", loc=cq.Location((x0 + 100, 600, z1 + 320)), color=COL["dark"])
    a.add(cyl_z(70, 90).faces(">Z").edges().fillet(20), name="BeaconLamp", loc=cq.Location((x0 + 300, -500, z1 + 165)), color=COL["amber"])

    def window(name, size_a, size_b, axis, pos):
        """ガラス＋ゴムの枠。axis はガラス面の法線方向"""
        if axis == "x":
            glass, frame = box(10, size_a, size_b), box(30, size_a + 40, size_b + 40).cut(box(32, size_a - 20, size_b - 20))
        else:
            glass, frame = box(size_a, 10, size_b), box(size_a + 40, 30, size_b + 40).cut(box(size_a - 20, 32, size_b - 20))
        a.add(glass, name=f"Glass{name}", loc=cq.Location(pos), color=COL["glass"])
        a.add(frame, name=f"Gasket{name}", loc=cq.Location(pos), color=COL["rubber"])

    window("Front", 1170, 1560, "x", (x1, 0, zm + 50))
    window("Rear", 1170, 1360, "x", (x0, 0, zm + 150))
    for side, sy in (("L", -1), ("R", 1)):
        window(f"Side{side}Upper", 1370, 760, "y", (xm, sy * 650, z0 + 1350))
        window(f"Side{side}Lower", 1370, 760, "y", (xm, sy * 650, z0 + 520))
        a.add(rbox(x1 - x0 - 90, 24, 70, 6), name=f"SideFrame{side}", loc=cq.Location((xm, sy * 650, z0 + 935)), color=Y)
        a.add(rod((x1, sy * 650, z1 - 100), (x1 + 250, sy * 900, z1 - 100), 15), name=f"MirrorArm{side}", color=COL["dark"])
        a.add(rbox(30, 190, 260, 10), name=f"Mirror{side}", loc=cq.Location((x1 + 260, sy * 900, z1 - 200)), color=COL["dark"])
        a.add(box(4, 170, 240), name=f"Mirror{side}_Glass", loc=cq.Location((x1 + 243, sy * 900, z1 - 200)), color=COL["bright"])
    # 左のドア（ヒンジ・取っ手・鍵）
    for k, hz in enumerate((z0 + 300, z0 + 1500), 1):
        a.add(cyl_z(16, 120), name=f"DoorHinge{k}", loc=cq.Location((x0 + 70, -690, hz)), color=COL["steel"])
    a.add(rbox(40, 30, 200, 8), name="DoorHandle", loc=cq.Location((x1 - 200, -690, z0 + 1000)), color=COL["dark"])
    a.add(cyl_y(14, 20), name="DoorKey", loc=cq.Location((x1 - 200, -690, z0 + 870)), color=COL["bright"])
    # ワイパー（前後）
    for name, wx, sgn in (("Front", x1 + 25, 1), ("Rear", x0 - 25, -1)):
        piv = (wx, 0, z0 + 280)
        a.add(cyl_x(25, 40), name=f"Wiper{name}_Pivot", loc=cq.Location(piv), color=COL["dark"])
        tipp = (wx + sgn * 10, -380, z0 + 1100)
        a.add(rod(piv, tipp, 8), name=f"Wiper{name}_Arm", color=COL["dark"])
        a.add(beam((wx + sgn * 18, -380, z0 + 700), (wx + sgn * 18, -380, z0 + 1500), 14, 20), name=f"Wiper{name}_Blade", color=COL["rubber"])
    # 作業灯（屋根の前後に2個ずつ）
    for k, (lx, ly, dirx) in enumerate([(x1 + 100, -450, 1), (x1 + 100, 450, 1), (x0 - 100, -450, -1), (x0 - 100, 450, -1)], 1):
        a.add(rbox(120, 160, 120, 15), name=f"WorkLight{k}", loc=cq.Location((lx, ly, z1 + 200)), color=COL["dark"])
        a.add(box(8, 130, 90), name=f"WorkLight{k}_Lens", loc=cq.Location((lx + dirx * 62, ly, z1 + 200)), color=COL["lens"])
        a.add(box(40, 40, 80), name=f"WorkLight{k}_Bracket", loc=cq.Location((lx, ly, z1 + 120)), color=COL["dark"])
        for j in range(3):
            a.add(box(100, 6, 90), name=f"WorkLight{k}_Fin{j + 1}", loc=cq.Location((lx - dirx * 10, ly - 40 + j * 40, z1 + 200)), color=COL["dark"])
    # 室内
    a.add(rbox(500, 520, 120, 40), name="SeatCushion", loc=cq.Location((-800, 0, z0 + 450)), color=COL["seat"])
    a.add(rbox(120, 520, 650, 40).rotate((0, 0, 0), (0, 1, 0), -10), name="SeatBack", loc=cq.Location((-1080, 0, z0 + 820)), color=COL["seat"])
    a.add(rbox(100, 300, 160, 40), name="Headrest", loc=cq.Location((-1150, 0, z0 + 1240)), color=COL["seat"])
    a.add(box(300, 300, 380), name="SeatBase", loc=cq.Location((-800, 0, z0 + 200)), color=COL["dark"])
    a.add(beam((-1050, -270, z0 + 600), (-600, 270, z0 + 470), 40, 6), name="SeatBelt", color=COL["dark"])
    for side, sy in (("L", -1), ("R", 1)):
        a.add(rbox(450, 120, 60, 20), name=f"Armrest{side}", loc=cq.Location((-820, sy * 320, z0 + 680)), color=COL["seat"])
        a.add(rbox(300, 160, 90, 20), name=f"Console{side}", loc=cq.Location((-650, sy * 330, z0 + 740)), color=COL["dark"])
        a.add(cyl_z(15, 200), name=f"Lever{side}", loc=cq.Location((-600, sy * 330, z0 + 880)), color=COL["dark"])
        a.add(cq.Workplane("XY").sphere(38), name=f"LeverKnob{side}", loc=cq.Location((-600, sy * 330, z0 + 1000)), color=COL["red"] if sy < 0 else COL["dark"])
        a.add(rbox(160, 120, 30, 8).rotate((0, 0, 0), (0, 1, 0), -25), name=f"Pedal{side}", loc=cq.Location((-200, sy * 180, z0 + 140)), color=COL["rubber"])
    a.add(rbox(200, 900, 500, 25), name="Dashboard", loc=cq.Location((-150, 0, z0 + 300)), color=COL["dark"])
    for k in range(12):
        col = [COL["red"], COL["amber"], COL["green"], COL["bright"]][k % 4]
        a.add(rbox(20, 40, 30, 4), name=f"DashSwitch{k + 1:02d}", loc=cq.Location((-45, -400 + k * 60, z0 + 420)), color=col)
    a.add(cyl_x(25, 20), name="KeySwitch", loc=cq.Location((-45, 380, z0 + 520)), color=COL["bright"])
    a.add(rbox(30, 260, 180, 8), name="Monitor", loc=cq.Location((-110, 300, z0 + 720)), color=COL["dark"])
    a.add(box(6, 230, 150), name="MonitorScreen", loc=cq.Location((-93, 300, z0 + 720)), color=COL["glass"])
    for k in range(4):
        a.add(cyl_x(45, 20), name=f"Gauge{k + 1}", loc=cq.Location((-40, -350 + k * 140, z0 + 520)), color=COL["lens"])
        a.add(cyl_x(50, 10).cut(cyl_x(44, 12)), name=f"Gauge{k + 1}_Ring", loc=cq.Location((-30, -350 + k * 140, z0 + 520)), color=COL["bright"])
    a.add(cyl_z(65, 450).faces(">Z").edges().fillet(30), name="FireExtinguisher", loc=cq.Location((x0 + 120, 500, z0 + 260)), color=COL["red"])
    a.add(cyl_z(20, 60), name="FireExtinguisherValve", loc=cq.Location((x0 + 120, 500, z0 + 520)), color=COL["dark"])
    return a


# ---------------- ブレード ----------------
def cylinder_parts(a, name, p1, p2, rb, rr, ratio, color_b, pin_axis_y=True):
    """油圧シリンダー：本体・ロッド・グランド・両端の目玉・ピン・ホース口"""
    mid = lerp(p1, p2, ratio)
    a.add(rod(p1, mid, rb), name=f"{name}_Barrel", color=color_b)
    a.add(rod(mid, p2, rr), name=f"{name}_Rod", color=COL["bright"])
    a.add(rod(lerp(p1, p2, ratio - 0.04), lerp(p1, p2, ratio + 0.01), rb + 12), name=f"{name}_Gland", color=color_b)
    a.add(rod(lerp(p1, p2, 0.02), lerp(p1, p2, 0.07), rb + 12), name=f"{name}_EndCap", color=color_b)
    for tag, pp in (("Base", p1), ("Head", p2)):
        a.add(cyl_y(rb * 0.75, rb * 1.2).faces("<Y or >Y").edges().chamfer(4), name=f"{name}_Eye{tag}", loc=cq.Location(pp), color=color_b)
        a.add(cyl_y(rb * 0.35, rb * 1.8), name=f"{name}_Pin{tag}", loc=cq.Location(pp), color=COL["steel"])
        a.add(nipple_z(), name=f"{name}_Nipple{tag}", loc=cq.Location((pp[0], pp[1], pp[2] + rb * 0.75)), color=COL["fitting"])
    ports = []
    for tag, t in (("PortA", 0.12), ("PortB", ratio - 0.08)):
        pp = lerp(p1, p2, t)
        pp = (pp[0], pp[1], pp[2] + rb + 10)
        a.add(rbox(50, 50, 30, 5), name=f"{name}_{tag}", loc=cq.Location(pp), color=color_b)
        ports.append((pp[0], pp[1], pp[2] + 15))
    return ports


def hose_with_fittings(a, name, points, r=16, color=None, fittings=True):
    """ホース＋両端の継手＋途中の固定バンド（中間の通過点ごとに1個）"""
    a.add(hose(points, r), name=name, color=color or COL["hose"])
    if fittings:
        fit = hex_prism(r * 2 + 8, 30).translate((0, 0, -15))
        for tag, pp in (("FittingA", points[0]), ("FittingB", points[-1])):
            a.add(fit, name=f"{name}_{tag}", loc=cq.Location(pp), color=COL["fitting"])
    for k in range(1, len(points) - 1):
        t = cq.Vector(*points[k + 1]) - cq.Vector(*points[k - 1])
        t = t.normalized() * 12
        c = cq.Vector(*points[k])
        a.add(rod((c - t).toTuple(), (c + t).toTuple(), r + 5), name=f"{name}_Clamp{k}", color=COL["bright"])


def blade() -> cq.Assembly:
    a = cq.Assembly(name="Blade")
    Y = COL["body"]
    bx = LS / 2 + R + 650
    half = 1700
    mold = (cq.Workplane("XZ").moveTo(bx + 150, 80).threePointArc((bx, 650), (bx + 150, 1250))
            .lineTo(bx + 190, 1250).threePointArc((bx + 40, 650), (bx + 190, 80)).close()
            .extrude(half, both=True))
    a.add(mold, name="Moldboard", color=Y)
    a.add(rbox(240, 2 * half, 60, 10), name="TopRail", loc=cq.Location((bx + 120, 0, 1270)), color=Y)
    a.add(box(60, 2 * half - 100, 60), name="SpillGuardLip", loc=cq.Location((bx + 210, 0, 1300)), color=Y)
    for side, sy in (("L", -1), ("R", 1)):
        plate = (cq.Workplane("XZ").moveTo(bx - 120, 80).lineTo(bx + 200, 80).lineTo(bx + 200, 1290)
                 .lineTo(bx - 80, 1100).close().extrude(15, both=True).edges("|Y").fillet(10))
        a.add(plate, name=f"EndPlate{side}", loc=cq.Location((0, sy * half, 0)), color=Y)
        eb = (cq.Workplane("XZ").polyline([(0, 0), (70, 0), (70, 280), (0, 230)]).close().extrude(150, both=True))
        a.add(eb, name=f"EndBit{side}", loc=cq.Location((bx + 180, sy * (half - 150), 0)), color=COL["dark"])
        for j, (dy, dz) in enumerate([(-80, 70), (80, 70), (-80, 170), (80, 170)], 1):
            a.add(to_axis(bolt_z(24, 12, 16, 60), "x", -1), name=f"EndBitBolt{side}{j}",
                  loc=cq.Location((bx + 252, sy * (half - 150) + dy, dz)), color=COL["bolt"])
    for k in range(3):
        a.add(rbox(160, 2 * half - 120, 70, 10), name=f"BackBrace{k + 1}", loc=cq.Location((bx - 50, 0, 300 + k * 400)), color=Y)
    for k in range(7):
        ry = -half + 250 + k * (2 * half - 500) / 6
        a.add(box(260, 20, 1050).edges("|Y").chamfer(30), name=f"BackRib{k + 1}", loc=cq.Location((bx - 10, ry, 680)), color=Y)
    # 刃先（3分割）・ボルト・裏ナット
    seg_w = (2 * half - 600) / 3
    ebolt = to_axis(bolt_z(24, 12, 16, 120), "x", -1)
    enut = to_axis(nut_z(24, 14, 16), "x", -1)
    for k in range(3):
        cy = -half + 300 + seg_w / 2 + k * seg_w
        ce = box(40, seg_w - 10, 220).edges("|Y and <Z").chamfer(12)
        a.add(ce, name=f"CuttingEdge{k + 1}", loc=cq.Location((bx + 200, cy, 110)), color=COL["dark"])
        for j in range(7):
            by = cy - seg_w / 2 + 70 + j * (seg_w - 140) / 6
            a.add(ebolt, name=f"EdgeBolt{k + 1}_{j + 1}", loc=cq.Location((bx + 220, by, 150)), color=COL["bolt"])
            a.add(enut, name=f"EdgeNut{k + 1}_{j + 1}", loc=cq.Location((bx + 136, by, 150)), color=COL["bolt"])
    # プッシュアーム・トラニオン
    arm_y = TRACK_Y + SHOE_W / 2 + 80
    for side, sy in (("L", -1), ("R", 1)):
        a.add(beam((-200, sy * arm_y, ZC), (bx - 80, sy * arm_y, 350), 120, 220, 20), name=f"PushArm{side}", color=Y)
        a.add(beam((800, sy * arm_y, 420), (bx - 80, sy * arm_y, 900), 90, 140, 15), name=f"PushArmStrut{side}", color=Y)
        a.add(cyl_y(95, 200).faces("<Y or >Y").edges().chamfer(8), name=f"Trunnion{side}", loc=cq.Location((-200, sy * arm_y, ZC)), color=COL["steel"])
        a.add(cyl_y(32, 270), name=f"TrunnionPin{side}", loc=cq.Location((-200, sy * arm_y, ZC)), color=COL["bright"])
        a.add(cyl_y(55, 30), name=f"TrunnionCap{side}", loc=cq.Location((-200, sy * (arm_y + 115), ZC)), color=COL["bolt"])
        for j in range(4):
            ang = math.pi / 4 + j * math.pi / 2
            a.add(to_axis(bolt_z(17, 9, 10, 25), "y", -sy), name=f"TrunnionBolt{side}{j + 1}",
                  loc=cq.Location((-200 + 75 * math.cos(ang), sy * (arm_y + 130), ZC + 75 * math.sin(ang))), color=COL["bolt"])
        a.add(cq.Workplane("XY").sphere(70), name=f"BladeBallJoint{side}", loc=cq.Location((bx - 80, sy * arm_y, 350)), color=COL["steel"])
        # リフトシリンダー＋ホース2本
        p1, p2 = (1950, sy * 520, 1550), (bx - 60, sy * 520, 1000)
        ports = cylinder_parts(a, f"LiftCyl{side}", p1, p2, 75, 40, 0.6, Y)
        a.add(rbox(160, 40, 200, 10), name=f"LiftCylBracket{side}", loc=cq.Location((p2[0] + 30, p2[1] + sy * 110, p2[2])), color=Y)
        a.add(rbox(200, 60, 220, 10), name=f"LiftCylMount{side}", loc=cq.Location((p1[0] - 20, sy * 610, p1[2])), color=Y)
        for h, pp in enumerate(ports, 1):
            src = (2050, sy * (420 + 60 * h), 1780)
            mid = ((src[0] + pp[0]) / 2, (src[1] + pp[1]) / 2, max(src[2], pp[2]) + 120)
            hose_with_fittings(a, f"LiftHose{side}{h}", [src, mid, pp])
    # チルトシリンダー（右）とブレース（左）
    tp1, tp2 = (900, arm_y, 520), (bx - 40, arm_y, 1150)
    ports = cylinder_parts(a, "TiltCyl", tp1, tp2, 60, 35, 0.55, Y)
    for h, pp in enumerate(ports, 1):
        src = (500, arm_y - 60 - 40 * h, 950)
        hose_with_fittings(a, f"TiltHose{h}", [src, ((src[0] + pp[0]) / 2, arm_y - 20, pp[2] + 150), pp], 14)
    bp1, bp2 = (900, -arm_y, 520), (bx - 40, -arm_y, 1150)
    a.add(rod(bp1, lerp(bp1, bp2, 0.7), 50), name="BladeBrace", color=Y)
    a.add(rod(lerp(bp1, bp2, 0.7), bp2, 35), name="BladeBraceScrew", color=COL["bright"])
    a.add(rod(lerp(bp1, bp2, 0.66), lerp(bp1, bp2, 0.72), 70), name="BladeBraceNut", color=COL["bolt"])
    return a


# ---------------- リッパー ----------------
def ripper() -> cq.Assembly:
    a = cq.Assembly(name="Ripper")
    Y = COL["body"]
    xb = -LS / 2 - R - 600
    a.add(rbox(200, 1100, 700, 20), name="RipperMount", loc=cq.Location((-2050, 0, 800)), color=Y)
    for j, (my, mz) in enumerate([(-450, 550), (450, 550), (-450, 1050), (450, 1050), (0, 550), (0, 1050)], 1):
        a.add(to_axis(bolt_z(24, 12, 16, 60), "x", -1), name=f"MountBolt{j}", loc=cq.Location((-2160, my, mz)), color=COL["bolt"])
    a.add(rbox(220, 1300, 220, 20), name="RipperBeam", loc=cq.Location((xb, 0, 750)), color=Y)
    shank = (cq.Workplane("XZ").polyline([(-70, 0), (70, 0), (90, 900), (40, 1100), (-70, 1100)]).close()
             .extrude(40, both=True).edges("|Y").fillet(15))
    a.add(shank, name="Shank", loc=cq.Location((xb - 20, 0, -100)), color=COL["dark"])
    tip = (cq.Workplane("XZ").polyline([(0, 0), (160, -40), (180, -10), (40, 80)]).close().extrude(48, both=True))
    a.add(tip, name="ShankTip", loc=cq.Location((xb + 40, 0, -110)), color=COL["steel"])
    a.add(box(30, 100, 160), name="ShankProtector", loc=cq.Location((xb + 70, 0, 120)), color=COL["steel"])
    a.add(cyl_y(30, 220), name="ShankPin", loc=cq.Location((xb - 20, 0, 800)), color=COL["bright"])
    for j, sz in enumerate((500, 650), 1):
        a.add(cyl_y(22, 120), name=f"ShankHole{j}", loc=cq.Location((xb - 20, 0, sz)), color=COL["rubber"])
    for side, sy in (("L", -1), ("R", 1)):
        a.add(beam((-2050, sy * 450, 500), (xb, sy * 450, 680), 80, 120, 12), name=f"LowerLink{side}", color=Y)
        p1, p2 = (-2050, sy * 300, 1150), (xb, sy * 300, 860)
        ports = cylinder_parts(a, f"RipperCyl{side}", p1, p2, 70, 38, 0.55, Y)
        for h, pp in enumerate(ports, 1):
            src = (-1990, sy * (220 + 60 * h), 1320)
            hose_with_fittings(a, f"RipperHose{side}{h}", [src, ((src[0] + pp[0]) / 2, src[1], pp[2] + 160), pp], 14)
        for k, pp in enumerate(((-2050, sy * 450, 500), (xb, sy * 450, 680)), 1):
            a.add(cyl_y(35, 140), name=f"LinkPin{side}{k}", loc=cq.Location(pp), color=COL["steel"])
    a.add(rbox(160, 200, 120, 15), name="HitchBlock", loc=cq.Location((xb - 60, 0, 1000)), color=Y)
    return a


# ---------------- エンジンまわり（フードの中） ----------------
def engine() -> cq.Assembly:
    """直列6気筒ディーゼル風（一般形）。フード内 x 200..2100, y ±590, z 950..1750 に収める"""
    a = cq.Assembly(name="EngineBay")
    E = cq.Color(0.30, 0.34, 0.38)      # エンジン本体の塗装
    BLK = COL["dark"]
    ex = 1120                           # エンジン中心の前後位置
    # 本体
    a.add(rbox(1000, 440, 380, 20), name="EngineBlock", loc=cq.Location((ex, 0, 1180)), color=E)
    a.add(rbox(980, 420, 120, 12), name="CylinderHead", loc=cq.Location((ex, 0, 1430)), color=E)
    a.add(rbox(950, 360, 90, 30), name="ValveCover", loc=cq.Location((ex, 0, 1535)), color=BLK)
    for k in range(6):
        a.add(rbox(40, 300, 20, 8), name=f"ValveCoverRib{k + 1}", loc=cq.Location((ex - 375 + k * 150, 0, 1585)), color=BLK)
        a.add(cyl_z(14, 60), name=f"Injector{k + 1}", loc=cq.Location((ex - 375 + k * 150, 120, 1600)), color=COL["bright"])
    for k in range(9):
        for sy in (-1, 1):
            a.add(bolt_z(13, 6, 8, 10).rotate((0, 0, 0), (1, 0, 0), 180), name=f"ValveCoverBolt{'L' if sy < 0 else 'R'}{k + 1}",
                  loc=cq.Location((ex - 440 + k * 110, sy * 165, 1586)), color=COL["bolt"])
    a.add(cyl_z(40, 40).faces(">Z").edges().fillet(8), name="OilFillerCap", loc=cq.Location((ex - 300, -100, 1600)), color=COL["amber"])
    for k, (mx, my) in enumerate([(ex - 420, -250), (ex - 420, 250), (ex + 420, -250), (ex + 420, 250)], 1):
        a.add(rbox(120, 100, 60, 10), name=f"EngineMount{k}", loc=cq.Location((mx, my, 985)), color=COL["rubber"])
    a.add(rbox(800, 360, 60, 10), name="OilPan", loc=cq.Location((ex, 0, 965)), color=E)
    # フライホイールハウジング
    a.add(cyl_x(300, 150).faces("<X or >X").edges().chamfer(10), name="FlywheelHousing", loc=cq.Location((ex - 575, 0, 1200)), color=E)
    for k in range(12):
        ang = 2 * math.pi * k / 12
        a.add(to_axis(bolt_z(17, 9, 10, 25), "x", 1), name=f"FlywheelBolt{k + 1:02d}",
              loc=cq.Location((ex - 490, 270 * math.cos(ang), 1200 + 270 * math.sin(ang))), color=COL["bolt"])
    # 吸気マニホールド（-Y側）
    a.add(rbox(900, 90, 110, 15), name="IntakeManifold", loc=cq.Location((ex, -260, 1430)), color=E)
    for k in range(6):
        a.add(to_axis(bolt_z(13, 6, 8, 20), "y", -1), name=f"IntakeBolt{k + 1}", loc=cq.Location((ex - 375 + k * 150, -306, 1470)), color=COL["bolt"])
    # 排気マニホールド（+Y側）とターボ
    for k in range(6):
        x = ex - 375 + k * 150
        a.add(rod((x, 205, 1430), (x, 290, 1400), 32), name=f"ExhaustRunner{k + 1}", color=COL["steel"])
    a.add(rod((ex - 420, 300, 1400), (ex + 340, 300, 1400), 50), name="ExhaustCollector", color=COL["steel"])
    tx = ex + 330
    a.add(cyl_y(110, 90), name="TurbineHousing", loc=cq.Location((tx, 360, 1520)), color=COL["steel"])
    a.add(cyl_y(55, 70), name="TurboCenterHousing", loc=cq.Location((tx, 440, 1520)), color=COL["bright"])
    a.add(cyl_y(100, 80).faces(">Y").edges().fillet(10), name="CompressorHousing", loc=cq.Location((tx, 510, 1520)), color=COL["bright"])
    a.add(rod((ex + 340, 300, 1400), (tx, 330, 1440), 50), name="TurbineInletPipe", color=COL["steel"])
    hose_with_fittings(a, "TurboExhaustPipe", [(tx, 360, 1630), (tx + 30, 330, 1720), (1500, 300, 1770)], 50, COL["steel"], fittings=False)
    # エアクリーナー → ターボ → インタークーラー管 → 吸気マニホールド
    a.add(cyl_x(110, 500).faces("<X or >X").edges().fillet(15), name="AirCleaner", loc=cq.Location((ex - 200, -390, 1620)), color=BLK)
    a.add(cyl_x(115, 40), name="AirCleanerCap", loc=cq.Location((ex - 470, -390, 1620)), color=BLK)
    for k, cx in enumerate((ex - 350, ex - 50), 1):
        a.add(ring_y(118, 110, 30).rotate((0, 0, 0), (0, 0, 1), 90), name=f"AirCleanerStrap{k}", loc=cq.Location((cx, -390, 1620)), color=COL["bright"])
    a.add(rod((1200, -300, 1790), (1200, -330, 1700), 50), name="PrecleanerDuct", color=BLK)
    hose_with_fittings(a, "IntakeHose", [(ex + 60, -390, 1620), (ex + 250, -150, 1690), (tx - 20, 300, 1680), (tx, 560, 1600)], 45, BLK, fittings=False)
    hose_with_fittings(a, "ChargeAirPipe", [(tx, 560, 1440), (tx + 200, 450, 1380), (ex + 450, -150, 1470), (ex + 420, -260, 1480)], 40, COL["steel"], fittings=False)
    # ラジエーター・ファン
    rx = 1990
    a.add(rbox(110, 1000, 60, 10), name="RadiatorTopTank", loc=cq.Location((rx, 0, 1640)), color=BLK)
    a.add(rbox(110, 1000, 60, 10), name="RadiatorBottomTank", loc=cq.Location((rx, 0, 990)), color=BLK)
    a.add(cyl_z(35, 30).faces(">Z").edges().fillet(6), name="RadiatorCap", loc=cq.Location((rx, 300, 1685)), color=COL["bright"])
    for k in range(50):
        a.add(box(100, 3, 590), name=f"RadiatorFin{k + 1:02d}", loc=cq.Location((rx, -490 + k * 20, 1315)), color=COL["fitting"])
    for sy in (-1, 1):
        a.add(box(110, 20, 710), name=f"RadiatorSide{'L' if sy < 0 else 'R'}", loc=cq.Location((rx, sy * 505, 1315)), color=BLK)
    a.add(ring_y(380, 350, 140).rotate((0, 0, 0), (0, 0, 1), 90), name="FanShroud", loc=cq.Location((1870, 0, 1320)), color=BLK)
    a.add(cyl_x(70, 90), name="FanHub", loc=cq.Location((1840, 0, 1320)), color=COL["steel"])
    for k in range(8):
        bl = (box(8, 110, 250).translate((0, 0, 190)).rotate((0, 0, 0), (0, 0, 1), 25)
              .rotate((0, 0, 0), (1, 0, 0), k * 45))
        a.add(bl, name=f"FanBlade{k + 1}", loc=cq.Location((1840, 0, 1320)), color=BLK)
    # プーリーとベルト、補機
    crank, fanp, alt = (1700, 0, 1080), (1790, 0, 1320), (1700, 300, 1300)
    a.add(cyl_x(110, 50), name="CrankPulley", loc=cq.Location(crank), color=COL["steel"])
    a.add(cyl_x(90, 50), name="FanPulley", loc=cq.Location(fanp), color=COL["steel"])
    a.add(cyl_x(45, 50), name="AlternatorPulley", loc=cq.Location((1760, 300, 1300)), color=COL["steel"])
    a.add(cyl_x(90, 150).faces("<X or >X").edges().fillet(10), name="Alternator", loc=cq.Location(alt), color=COL["bright"])
    bx = 1790
    for name, p1, p2 in (("BeltCrankFan", (bx, 105, 1090), (bx, 88, 1330)), ("BeltFanAlt", (bx, 80, 1360), (bx, 300, 1345)),
                         ("BeltAltCrank", (bx, 340, 1290), (bx, 90, 1020))):
        a.add(beam_yz(p1, p2, 30, 10), name=name, color=COL["rubber"])
    a.add(cyl_x(70, 80), name="WaterPump", loc=cq.Location((1700, 120, 1200)), color=E)
    a.add(rbox(80, 90, 90, 10), name="ThermostatHousing", loc=cq.Location((1660, 0, 1520)), color=E)
    hose_with_fittings(a, "UpperRadiatorHose", [(1700, 0, 1530), (1820, 60, 1600), (rx - 60, 120, 1640)], 35, BLK)
    hose_with_fittings(a, "LowerRadiatorHose", [(1740, 120, 1200), (1850, 250, 1060), (rx - 60, 300, 990)], 35, BLK)
    a.add(cyl_x(60, 250), name="StarterMotor", loc=cq.Location((ex - 450, -300, 1080)), color=BLK)
    a.add(cyl_z(55, 160).faces(">Z").edges().fillet(8), name="OilFilter", loc=cq.Location((ex - 100, -300, 1080)), color=COL["amber"])
    for k, fx in enumerate((ex + 150, ex + 280), 1):
        a.add(cyl_z(45, 160), name=f"FuelFilter{k}", loc=cq.Location((fx, -320, 1100)), color=COL["bright"])
        a.add(rbox(110, 110, 50, 8), name=f"FuelFilterHead{k}", loc=cq.Location((fx, -320, 1205)), color=E)
    a.add(rod((ex - 250, -235, 1100), (ex - 250, -300, 1640), 6), name="Dipstick", color=COL["amber"])
    a.add(ring_y(20, 12, 8), name="DipstickHandle", loc=cq.Location((ex - 250, -300, 1660)), color=COL["amber"])
    # マフラー（排気管の根元）
    a.add(cyl_x(130, 500).faces("<X or >X").edges().fillet(20), name="Muffler", loc=cq.Location((1500, 300, 1660)), color=COL["steel"])
    # 配線
    for k, (pts, rr) in enumerate([
        ([(1700, 380, 1300), (1500, 380, 1250), (900, 330, 1200), (ex - 450, -240, 1150), (ex - 450, -300, 1140)], 9),
        ([(ex - 375, 150, 1630), (ex, 170, 1640), (ex + 375, 150, 1630)], 6),
        ([(ex - 100, -300, 1180), (ex - 300, -320, 1250), (ex - 450, -330, 1150)], 6)], 1):
        hose_with_fittings(a, f"WiringHarness{k}", pts, rr, cq.Color(0.10, 0.10, 0.10), fittings=False)
    # バッテリー箱（右の泥よけの上）
    bxp, byp, bzp = -600, 1000, ZC + R + 146
    a.add(box(620, 330, 360).faces(">Z").shell(-8).translate((0, 0, 180)), name="BatteryBox", loc=cq.Location((bxp, byp, bzp)), color=COL["body"])
    a.add(rbox(640, 350, 20, 6), name="BatteryBoxLid", loc=cq.Location((bxp, byp, bzp + 372)), color=COL["body"])
    for k, dxb in enumerate((-150, 150), 1):
        a.add(rbox(260, 280, 300, 8), name=f"Battery{k}", loc=cq.Location((bxp + dxb, byp, bzp + 158)), color=BLK)
        for j, dy in enumerate((-90, 90), 1):
            a.add(cyl_z(15, 30), name=f"Battery{k}_Terminal{j}", loc=cq.Location((bxp + dxb - 80, byp + dy, bzp + 323)), color=COL["red"] if j == 1 else COL["bright"])
    hose_with_fittings(a, "BatteryCable", [(bxp + 70, byp + 90, bzp + 340), (bxp + 150, byp - 60, bzp + 350), (bxp + 220, byp - 90, bzp + 340)], 10, COL["red"], fittings=False)
    return a


def build() -> cq.Assembly:
    root = cq.Assembly(name="Bulldozer", loc=cq.Location((0, 0, 0), (1, 0, 0), -90))
    root.add(track_side("L", -1))
    root.add(track_side("R", 1))
    root.add(body())
    root.add(cab())
    root.add(blade())
    root.add(ripper())
    root.add(engine())
    return root


def count(a: cq.Assembly) -> int:
    return (1 if a.obj is not None else 0) + sum(count(c) for c in a.children)


if __name__ == "__main__":
    asm = build()
    print("parts:", count(asm))
    asm.export(sys.argv[1])
    print("written:", sys.argv[1])
