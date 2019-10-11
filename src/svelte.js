import { add, update, remove } from './listener.js'

const nodeMap = new Map()
let _id = 0
let currentBlock

export function getNode(id) {
  return nodeMap.get(id)
}

export function getAllNodes() {
  nodeMap.values()
}

const rootNodes = []
export function getRootNodes() {
  return rootNodes
}

function addNode(node, target, anchor) {
  nodeMap.set(node.id, node)
  nodeMap.set(node.detail, node)

  let targetNode = nodeMap.get(target)
  if (!targetNode || targetNode.parentBlock != node.parentBlock) {
    targetNode = node.parentBlock
  }

  node.parent = targetNode

  const anchorNode = nodeMap.get(anchor)

  if (targetNode) {
    let index = -1
    if (anchorNode) index = targetNode.children.indexOf(anchorNode)

    if (index != -1) {
      targetNode.children.splice(index, 0, node)
    } else {
      targetNode.children.push(node)
    }
  } else {
    rootNodes.push(node)
  }

  add(node, anchorNode)
}

function removeNode(node) {
  if (!node) return

  nodeMap.delete(node.id)
  nodeMap.delete(node.detail)

  const index = node.parent.children.indexOf(node)
  node.parent.children.splice(index, 1)
  node.parent = null

  remove(node)
}

function updateElement(element) {
  const node = nodeMap.get(element)
  if (!node) return

  if (node.type == 'anchor') node.type = 'text'

  update(node)
}

function insert(element, target, anchor) {
  const node = {
    id: _id++,
    type:
      element.nodeType == 1
        ? 'element'
        : element.nodeValue && element.nodeValue != ' '
        ? 'text'
        : 'anchor',
    detail: element,
    tagName: element.nodeName.toLowerCase(),
    parentBlock: currentBlock,
    children: []
  }
  addNode(node, target, anchor)

  for (const child of element.childNodes) {
    if (!nodeMap.has(child)) insert(child, element)
  }
}

document.addEventListener('SvelteRegisterComponent', e => {
  const { component, tagName } = e.detail

  const node = nodeMap.get(component.$$.fragment)
  if (node) {
    nodeMap.delete(component.$$.fragment)

    node.detail = component
    node.tagName = tagName

    update(node)
  } else {
    nodeMap.set(component.$$.fragment, {
      type: 'component',
      detail: component,
      tagName
    })
  }
})

// Ugly hack b/c promises are resolved/rejected outside of normal render flow
let lastPromiseParent = null
document.addEventListener('SvelteRegisterBlock', e => {
  const { type, id, block, ...detail } = e.detail
  const tagName = type == 'pending' ? 'await' : type
  const nodeId = _id++

  const mountFn = block.m
  const updateFn = block.p
  const detachFn = block.d
  block.m = (target, anchor) => {
    const parentBlock = currentBlock
    let node = {
      id: nodeId,
      type: 'block',
      detail,
      tagName,
      parentBlock,
      children: []
    }

    switch (type) {
      case 'then':
      case 'catch':
        if (!node.parentBlock) node.parentBlock = lastPromiseParent
        break

      case 'slot':
        node.type = 'slot'
        break

      case 'component':
        const componentNode = nodeMap.get(block)
        if (componentNode) {
          nodeMap.delete(block)
          Object.assign(node, componentNode)
        } else {
          Object.assign(node, {
            type: 'component',
            tagName: 'Unknown',
            detail: {}
          })
          nodeMap.set(block, node)
        }

        Promise.resolve().then(
          () =>
            node.detail.$$ &&
            Object.keys(node.detail.$$.bound).length &&
            update(node)
        )
        break
    }

    if (type == 'each') {
      let group = nodeMap.get(parentBlock.id + id)
      if (!group) {
        group = {
          id: _id++,
          type: 'block',
          detail: {
            ctx: {},
            source: detail.source
          },
          tagName: 'each',
          parentBlock,
          children: []
        }
        nodeMap.set(parentBlock.id + id, group)
        addNode(group, target, anchor)
      }
      node.parentBlock = group
      node.type = 'iteration'
      addNode(node, group, anchor)
    } else {
      addNode(node, target, anchor)
    }

    currentBlock = node
    mountFn(target, anchor)
    currentBlock = parentBlock
  }

  block.p = (changed, ctx) => {
    const parentBlock = currentBlock
    currentBlock = nodeMap.get(nodeId)

    update(currentBlock)

    updateFn(changed, ctx)

    currentBlock = parentBlock
  }

  block.d = detaching => {
    const node = nodeMap.get(nodeId)

    if (node) {
      if (node.tagName == 'await') lastPromiseParent = node.parentBlock

      removeNode(node)
    }

    detachFn(detaching)
  }
})

document.addEventListener('SvelteDOMInsert', e => {
  const { node: element, target, anchor } = e.detail

  insert(element, target, anchor)
})

document.addEventListener('SvelteDOMRemove', e => {
  const node = nodeMap.get(e.detail.node)
  if (!node) return

  removeNode(node)
})

document.addEventListener('SvelteDOMAddEventListener', e => {
  const { node, ...detail } = e.detail

  if (!node.__listeners) node.__listeners = []

  node.__listeners.push(detail)
})

document.addEventListener('SvelteDOMRemoveEventListener', e => {
  const { node, event, handler, modifiers } = e.detail

  if (!node.__listeners) return

  const index = node.__listeners.findIndex(
    o => o.event == event && o.handler == handler && o.modifiers == modifiers
  )

  if (index == -1) return

  node.__listeners.splice(index, 1)
})

document.addEventListener('SvelteDOMSetData', e => updateElement(e.detail.node))
document.addEventListener('SvelteDOMSetProperty', e =>
  updateElement(e.detail.node)
)
document.addEventListener('SvelteDOMSetAttribute', e =>
  updateElement(e.detail.node)
)
document.addEventListener('SvelteDOMRemoveAttribute', e =>
  updateElement(e.detail.node)
)
