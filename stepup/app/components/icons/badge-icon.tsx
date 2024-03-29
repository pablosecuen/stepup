import React, { SVGProps } from "react";

const createPathStyle = (fillColor: string): SVGProps<SVGGElement>["style"] => ({
  stroke: "none",
  strokeWidth: 1,
  strokeDasharray: "none",
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  strokeMiterlimit: 10,
  fill: fillColor,
  fillRule: "nonzero",
  opacity: 1,
});

const Badgeicon = () => {
  const pathStyle = createPathStyle("rgb(237,99,98)");
  const pathStyle1 = createPathStyle("rgb(233,84,84)");
  const pathStyle2 = createPathStyle("rgb(236,153,34)");
  const pathStyle3 = createPathStyle("rgb(255, 204, 91)");
  const pathStyle4 = createPathStyle("rgb(253,188,75)");
  const pathStyle5 = createPathStyle("rgb(236,153,34)");

  const minX = 0; // Mínima coordenada X
  const minY = 0; // Mínima coordenada Y
  const maxX = 256; // Máxima coordenada X
  const maxY = 256; // Máxima coordenada Y

  return (
    <svg
      version="1.1"
      width="256"
      height="256"
      viewBox={`${minX} ${minY} ${maxX} ${maxY}`}
      className="border w-auto"
    >
      <defs></defs>
      <g transform="translate(1 1) scale(1 1)">
        <path
          d="M 44.759 63.847 L 56.954 90 l 9.909 -9.079 l 13.325 -1.755 L 68.323 53.721 c -9.609 -0.082 -17.439 3.046 -23.082 10.126"
          style={pathStyle}
          transform="matrix(1 0 0 1 0 0)"
          strokeLinecap="round"
        />
        <path
          d="M 45.241 63.847 L 33.046 90 l -9.909 -9.079 L 9.812 79.166 l 11.865 -25.445 C 33.52 52.826 41.539 56.026 45.241 63.847 z"
          style={pathStyle1}
          transform="matrix(1 0 0 1 0 0)"
          strokeLinecap="round"
        />
        <path
          d="M 45 63.847 c 17.631 0 31.923 -14.293 31.923 -31.923 S 62.631 0 45 0 C 34.483 21.782 33.645 43.104 45 63.847 z"
          style={pathStyle2}
          transform="matrix(1 0 0 1 0 0)"
          strokeLinecap="round"
        />
        <path
          d="M 45 63.847 c -17.631 0 -31.923 -14.293 -31.923 -31.923 S 27.369 0 45 0 v 63.814"
          style={pathStyle2}
          transform="matrix(1 0 0 1 0 0)"
          strokeLinecap="round"
        />
        <path
          d="M 38.778 54.411 c -0.092 0 -0.186 -0.013 -0.279 -0.039 C 26.122 50.786 18.967 37.8 22.552 25.422 c 0.153 -0.531 0.707 -0.836 1.239 -0.682 c 0.53 0.153 0.836 0.708 0.682 1.239 c -3.277 11.318 3.264 23.193 14.583 26.471 c 0.53 0.154 0.836 0.709 0.682 1.239 C 39.611 54.127 39.211 54.411 38.778 54.411 z"
          style={pathStyle3}
          transform="matrix(1 0 0 1 0 0)"
          strokeLinecap="round"
        />
        <path
          d="M 66.487 39.146 c -0.092 0 -0.186 -0.013 -0.278 -0.04 c -0.53 -0.154 -0.836 -0.708 -0.683 -1.239 c 1.589 -5.483 0.946 -11.256 -1.808 -16.256 c -2.755 -5 -7.291 -8.628 -12.774 -10.216 c -0.53 -0.153 -0.836 -0.708 -0.683 -1.239 c 0.154 -0.53 0.708 -0.835 1.239 -0.682 c 5.996 1.736 10.957 5.704 13.969 11.172 c 3.013 5.468 3.715 11.781 1.979 17.777 C 67.321 38.862 66.922 39.146 66.487 39.146 z"
          style={pathStyle4}
          strokeLinecap="round"
        />
        <path
          d="M 37.058 47.693 c -0.225 0 -0.449 -0.075 -0.633 -0.227 c -0.374 -0.306 -0.476 -0.836 -0.241 -1.259 l 6.723 -12.121 l -5.127 -2.93 c -0.283 -0.162 -0.47 -0.451 -0.5 -0.776 c -0.03 -0.325 0.1 -0.644 0.348 -0.854 l 14.177 -12.04 c 0.359 -0.304 0.878 -0.317 1.253 -0.034 c 0.374 0.285 0.499 0.791 0.302 1.217 l -5.036 10.86 l 5.096 2.766 c 0.289 0.157 0.482 0.447 0.517 0.775 c 0.034 0.328 -0.095 0.651 -0.346 0.865 L 37.706 47.455 C 37.52 47.613 37.289 47.693 37.058 47.693 z"
          style={pathStyle5}
          transform="matrix(1 0 0 1 0 0)"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
};

export default Badgeicon;
