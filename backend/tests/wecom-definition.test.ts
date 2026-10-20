import { describe, expect, it } from 'vitest';
import { loadOntologyCatalog } from '../src/ontology/catalog.js';
import { enterpriseSource, enterpriseTaxonomy } from '../src/ontology/enterprise.js';

const catalog = loadOntologyCatalog();
const marker = '企业微信 wecom-mcp 已核对的成功同步快照字段';

function sourcedItems(dimension: 'properties' | 'relations' | 'rules') {
  return catalog.objects.flatMap((definition) => definition.items[dimension]
    .filter((item) => item.source.includes(marker))
    .map((item) => ({ definition, item })));
}

describe('WeCom ontology-definition supplements', () => {
  it('adds exactly the reviewed source fields without changing the registered 930-object taxonomy', () => {
    const participating = new Set([
      ...sourcedItems('properties'),
      ...sourcedItems('relations'),
      ...sourcedItems('rules'),
    ].map(({ definition }) => definition.code));
    expect(participating).toEqual(new Set([
      'org_unit', 'user', 'membership',
      'ent_b14_b4d203dea5b9121c', 'ent_b14_f128cdf1dae21223', 'ent_b14_345b3c5bd988b2d6',
      'ent_b14_a1f5d5fcbdc4d510', 'ent_b14_f60282c6d68918d5', 'ent_b14_3d834a5b98df29e2', 'ent_b14_39a0ae1ee3c9fe4f',
    ]));
    expect(sourcedItems('properties')).toHaveLength(86);
    expect(sourcedItems('relations')).toHaveLength(23);
    expect(sourcedItems('rules')).toHaveLength(18);

    expect(catalog.objects).toHaveLength(930);
    expect(enterpriseSource().objects).toHaveLength(878);
    const taxonomy = enterpriseTaxonomy(catalog.objects);
    expect(taxonomy.nodes.filter((node) => node.level === 1)).toHaveLength(18);
    expect(taxonomy.nodes.filter((node) => node.level === 2)).toHaveLength(153);
    expect(taxonomy.nodes.filter((node) => node.level === 3)).toHaveLength(354);
  });

  it('keeps the three existing object definitions at their approved WeCom attribute counts', () => {
    const find = (code: string) => catalog.objects.find((definition) => definition.code === code)!;
    expect(find('org_unit').items.properties).toHaveLength(16);
    expect(find('user').items.properties).toHaveLength(15);
    expect(find('membership').items.properties).toHaveLength(11);
  });

  it('retains activation status strictly as a raw WeCom account field, never an HR state', () => {
    const activation = sourcedItems('properties').filter(({ item }) => item.code === 'wecom_activation_status');
    expect(activation).toHaveLength(3);
    for (const { item } of activation) {
      expect(item.description).toContain('仅为企业微信账号激活状态');
      expect(item.description).toContain('不代表在职、离职或劳动关系状态');
    }
  });
});
