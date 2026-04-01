{
  description = "Claw Migration OpenClaw plugin";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      claw-migration-cli = pkgs.writeShellApplication {
        name = "claw-migration";
        runtimeInputs = [ pkgs.nodejs_24 ];
        text = ''
          exec ${./bin/claw-migration.js} "$@"
        '';
      };
    in {
      packages.${system}.claw-migration-cli = claw-migration-cli;
      packages.${system}.default = claw-migration-cli;

      openclawPlugin = {
        name = "claw-migration";
        packages = [ claw-migration-cli ];
        skills = ./skills;
        needs = [ "nodejs_24" ];
      };
    };
}
