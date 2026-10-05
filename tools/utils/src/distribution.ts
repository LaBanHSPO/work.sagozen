import { PackageList, type PackageName } from './yarn';

export const PackageToDistribution: Partial<
  Record<PackageName, BUILD_CONFIG_TYPE['distribution']>
> = {
  '@affine/admin': 'admin',
  '@affine/web': 'web',
};

export const AliasToPackage = new Map<string, PackageName>([
  ['admin', '@affine/admin'],
  ['web', '@affine/web'],
  ['server', '@affine/server'],
  ['gql', '@affine/graphql'],
  ...PackageList.map(
    pkg => [pkg.name.split('/').pop()!, pkg.name] as [string, PackageName]
  ),
]);
