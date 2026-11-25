"""Bake the two curved glass profiles and both liquid colors using Blender Cycles.

Run: blender -b -t 8 --python-exit-code 2 --python scripts/render-twin-glass.py -- standard OUTPUT
Repeat with narrow, then pack the captured frames with pack-twin-glass.py.
"""
import bpy
from pathlib import Path
from math import sin, cos, sqrt, pi
from mathutils import Vector
import sys

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.cycles.transmission_bounces = 12
scene.render.resolution_x, scene.render.resolution_y = 384, 120
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new("Dark studio")
scene.world.color = (.035, .035, .035)
layout, output = sys.argv[-2:]
assert layout in {"standard", "narrow"}
output = Path(output)
output.mkdir(exist_ok=True, parents=True)

def shoulder(x, z, radius):
    ratio = min(.9999, abs(z) / radius)
    return x * ((1-ratio**3.65)**(1/3.65)) / sqrt(1-ratio**2)

def glass(name, color, ior, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Transmission Weight"].default_value = 1
    shader.inputs["IOR"].default_value = ior
    shader.inputs["Roughness"].default_value = roughness
    return material

def chamber(x):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, location=(x, 0, 0))
    lens = bpy.context.object
    lens.name = "Curved glass"
    lens.scale = (1.50, .61, .93)
    bpy.ops.object.transform_apply(location=False, scale=True, rotation=False)
    if layout == "narrow":
        for vertex in lens.data.vertices:
            vertex.co.x = shoulder(vertex.co.x, vertex.co.z, .93)
    lens.data.materials.append(glass("Optical glass", (.96, .98, 1), 1.47, .055))
    bpy.ops.object.shade_smooth()
    shell = lens.modifiers.new("Wall thickness", "SOLIDIFY")
    shell.thickness = .046

def fill(x, level, material):
    slices, sides = 28, 96
    top = -.86 + 1.72 * level
    vertices = []
    for ring in range(slices+1):
        z = -.86 + (top + .86) * ring / slices
        radius = sqrt(max(.0001, 1-(z/.89)**2))
        for step in range(sides):
            angle = 2 * pi * step / sides
            px = 1.47 * radius * cos(angle)
            if layout == "narrow":
                px = shoulder(px, z, .89)
            vertices.append((px, .575 * radius * sin(angle), z))
    faces = [tuple(reversed(range(sides)))]
    for ring in range(slices):
        start = ring * sides
        for step in range(sides):
            a, b = start + step, start + (step + 1) % sides
            faces.append((a, b, b+sides, a+sides))
    # Turn the last side-wall ring into a concave liquid/air boundary.
    # The outer contact line stays fixed against the glass while the center drops.
    contact = vertices[-sides:]
    for radial, drop in ((.993,.015), (.979,.035), (.955,.054), (.92,.066), (.84,.071), (.65,.072), (.32,.072)):
        previous = len(vertices) - sides
        start = len(vertices)
        vertices.extend((px*radial, py*radial, top-min(drop, (top+.86)*.65)) for px, py, _ in contact)
        for step in range(sides):
            nxt = (step + 1) % sides
            faces.append((previous+step, previous+nxt, start+nxt, start+step))
    faces.append(tuple(range(len(vertices)-sides, len(vertices))))
    mesh = bpy.data.meshes.new("Ellipsoid with liquid free surface")
    mesh.from_pydata(vertices, [], faces)
    liquid = bpy.data.objects.new("Transmissive liquid", mesh)
    liquid.location.x = x
    bpy.context.collection.objects.link(liquid)
    liquid.data.materials.append(material)
    for face in mesh.polygons:
        face.use_smooth = len(face.vertices) == 4
    return liquid

def softbox(name, position, point, width, height, tint, strength):
    bpy.ops.mesh.primitive_plane_add(size=2, location=position)
    card = bpy.context.object
    card.name = name
    card.scale = (width, height, 1)
    card.rotation_euler = (Vector(point)-card.location).to_track_quat("Z", "Y").to_euler()
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    uv = tree.nodes.new("ShaderNodeTexCoord")
    vector = tree.nodes.new("ShaderNodeVectorMath")
    vector.operation = "DISTANCE"
    vector.inputs[1].default_value = (.5, .5, 0)
    tree.links.new(uv.outputs["UV"], vector.inputs[0])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].position = .02
    ramp.color_ramp.elements[0].color = (*tint, 1)
    ramp.color_ramp.elements[1].position = .48
    ramp.color_ramp.elements[1].color = (0,0,0,1)
    tree.links.new(vector.outputs["Value"], ramp.inputs["Fac"])
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = strength
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    card.data.materials.append(material)
    card.visible_camera = False

chamber(-1.61)
chamber(1.61)
softbox("Overhead reflection", (0,-3.8,3.5), (0,0,0), 4.2, .8, (.82,.91,1), 10)
softbox("Left vertical reflection", (-5,-2.2,.28), (0,0,0), .40, 2.4, (.78,.87,1), 30)
softbox("Right vertical reflection", (5,-2.2,.1), (0,0,0), .40, 2.4, (1,.88,.8), 27)
softbox("Blue light on foot", (-1.85,-1.7,-1.68), (-1.61,0,-.70), 1.30, .22, (.09,.43,1), 67)
softbox("Violet light on foot", (1.83,-1.7,-1.68), (1.61,0,-.70), 1.30, .22, (.58,.08,1), 61)
softbox("Blue reflected strip", (-2.4,-.75,-1.12), (-1.7,0,-.53), .50, .17, (.13,.49,1), 46)
softbox("Violet reflected strip", (2.4,-.75,-1.12), (1.7,0,-.53), .50, .17, (.77,.14,1), 46)

bpy.ops.object.camera_add(location=(0,-10,1))
camera = bpy.context.object
camera.rotation_euler = (Vector((0,0,0))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.type, camera.data.ortho_scale = "ORTHO", 6.8
scene.camera = camera
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = .42
blue = glass("Indigo liquid", (.17,.30,.99), 1.333, .025)
violet = glass("Violet liquid", (.73,.15,.94), 1.333, .025)
for percent in range(0, 101, 2):
    if percent:
        liquids = [fill(-1.61, percent / 100, blue), fill(1.61, percent / 100, violet)]
    scene.render.filepath = str(output / f"{layout}-{percent:03}.png")
    bpy.ops.render.render(write_still=True)
    if percent:
        for liquid in liquids:
            mesh = liquid.data
            bpy.data.objects.remove(liquid, do_unlink=True)
            bpy.data.meshes.remove(mesh)
