import type { TOCItem } from '../pdf/types';

export interface TOCNode {
  id: string;
  title: string;
  pageNum: number;
  level: number;
  y?: number;
  children: TOCNode[];
}

/**
 * Builds a hierarchical tree from a flat list of TOC items with level depth indicators.
 */
export function buildTOCTree(items: TOCItem[]): TOCNode[] {
  const rootNodes: TOCNode[] = [];
  const stack: { node: TOCNode; level: number }[] = [];

  items.forEach((item, index) => {
    const node: TOCNode = {
      id: `toc-node-${index}-${item.pageNum}-${item.level}`,
      title: item.title,
      pageNum: item.pageNum,
      level: item.level,
      y: item.y,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootNodes.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, level: item.level });
  });

  return rootNodes;
}

/**
 * Collects all node IDs that have at least one child (i.e. collapsible nodes).
 */
export function collectCollapsibleNodeIds(nodes: TOCNode[]): Set<string> {
  const ids = new Set<string>();

  function traverse(nodeList: TOCNode[]) {
    for (const node of nodeList) {
      if (node.children.length > 0) {
        ids.add(node.id);
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return ids;
}

/**
 * Finds the TOC node that best corresponds to the current reading page.
 * Returns the node ID of the most specific section starting at or before currentPage.
 */
export function findActiveTOCNodeId(nodes: TOCNode[], currentPage: number): string | null {
  let activeId: string | null = null;
  let highestPageSeen = -1;

  function traverse(nodeList: TOCNode[]) {
    for (const node of nodeList) {
      if (node.pageNum <= currentPage && node.pageNum >= highestPageSeen) {
        highestPageSeen = node.pageNum;
        activeId = node.id;
      }
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return activeId;
}

/**
 * Filters the TOC tree matching a search query.
 * Keeps matching nodes and all their ancestor nodes so the tree path remains intact.
 */
export function filterTOCTree(nodes: TOCNode[], query: string): { filtered: TOCNode[]; matchingIds: Set<string> } {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) {
    return { filtered: nodes, matchingIds: new Set() };
  }

  const matchingIds = new Set<string>();

  function filterNodes(list: TOCNode[]): TOCNode[] {
    const result: TOCNode[] = [];

    for (const node of list) {
      const matchesSelf = node.title.toLowerCase().includes(cleanQuery);
      const filteredChildren = filterNodes(node.children);

      if (matchesSelf || filteredChildren.length > 0) {
        if (matchesSelf) {
          matchingIds.add(node.id);
        }
        result.push({
          ...node,
          children: filteredChildren,
        });
      }
    }

    return result;
  }

  const filtered = filterNodes(nodes);
  return { filtered, matchingIds };
}
