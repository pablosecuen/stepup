const InformationForm = ({ formData, handleChange, handleSubmit, handleTabChange }: any) => {
  return (
    <form onSubmit={handleSubmit} className="w-auto ">
      <div className="pb-8">
        <h3 className="md:mb-4 font-bold tracking-wide">Contacto</h3>
        <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
          <label htmlFor="area_code" className="block opacity-60 text-xs -mb-1">
            Cod. de area:
          </label>
          <input
            type="text"
            id="area_code"
            name="area_code"
            value={formData.area_code}
            onChange={handleChange}
            className=" text-sm h-6 w-full border-none "
            required
          />
        </div>
        <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
          <label htmlFor="number" className="block opacity-60 text-xs -mb-1">
            Teléfono:
          </label>
          <input
            type="text"
            id="number"
            name="number"
            value={formData.number}
            onChange={handleChange}
            className=" text-sm h-6 w-full border-none"
            required
          />
        </div>
        <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
          <label htmlFor="telefono" className="block opacity-60 text-xs -mb-2">
            Mail:
          </label>
          <input
            type="email"
            id="mail"
            name="mail"
            onChange={handleChange}
            className="  h-6 text-sm md:h-8   w-full border-none"
            required
          />
        </div>
        <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
          <label htmlFor="dni" className="block opacity-60 text-xs -mb-2">
            Dni:
          </label>
          <input
            type="dni"
            id="dni"
            name="dni"
            onChange={handleChange}
            className="  h-6 text-sm md:h-8   w-full"
            required
          />
        </div>
      </div>
      <div>
        <h3 className="md:mb-4 font-bold tracking-wide">Datos de envio</h3>
        <div className="md:flex md:gap-2">
          <div className="mb-4 border md:w-1/2 border-gray-500/80 rounded-lg px-2 py-1 ">
            <label htmlFor="firstname" className="block opacity-60 text-xs -mb-2">
              Nombre:
            </label>
            <input
              type="text"
              id="firstname"
              name="firstname"
              value={formData.firstname}
              onChange={handleChange}
              className="  h-6 text-sm md:h-8   w-full border-none"
              required
            />
          </div>
          <div className="mb-4 border md:w-1/2 border-gray-500/80 rounded-lg px-2 py-1 ">
            <label htmlFor="lastname" className="block opacity-60 text-xs -mb-2">
              Apellido:
            </label>
            <input
              type="text"
              id="lastname"
              name="lastname"
              value={formData.lastname}
              onChange={handleChange}
              className="  h-6 text-sm md:h-8   w-full border-none"
              required
            />
          </div>
        </div>

        <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
          <label htmlFor="calle" className="block opacity-60 text-xs -mb-2">
            Calle:
          </label>
          <input
            type="text"
            id="calle"
            name="calle"
            value={formData.calle}
            onChange={handleChange}
            className="  h-6 text-sm md:h-8   w-full border-none"
            required
          />
        </div>
        <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
          <label htmlFor="altura" className="block opacity-60 text-xs -mb-2">
            Altura:
          </label>
          <input
            type="text"
            id="altura"
            name="altura"
            value={formData.altura}
            onChange={handleChange}
            className="  h-6 text-sm md:h-8   w-full border-none"
            required
          />
        </div>
        <div className="md:flex md:gap-2">
          <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
            <label htmlFor="ciudad" className="block opacity-60 text-xs -mb-2">
              Ciudad:
            </label>
            <input
              type="text"
              id="ciudad"
              name="ciudad"
              value={formData.ciudad}
              onChange={handleChange}
              className="  h-6 text-sm md:h-8   w-full border-none"
              required
            />
          </div>
          <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
            <label htmlFor="provincia" className="block opacity-60 text-xs -mb-2">
              Provincia:
            </label>
            <input
              type="text"
              id="provincia"
              name="provincia"
              value={formData.provincia}
              onChange={handleChange}
              className="  h-6 text-sm md:h-8   w-full border-none"
              required
            />
          </div>
          <div className="mb-4 border border-gray-500/80 rounded-lg px-2 py-1 ">
            <label htmlFor="codigoPostal" className="block opacity-60 text-xs -mb-2">
              Código Postal:
            </label>
            <input
              type="text"
              id="codigoPostal"
              name="codigoPostal"
              value={formData.codigoPostal}
              onChange={handleChange}
              className="  h-6 text-sm md:h-8   w-full border-none"
              required
            />
          </div>
        </div>
      </div>
      <div className="md:flex md:justify-end text-white">
        <button
          type="button"
          onClick={() => handleTabChange("shipping")}
          className="bg-blue-600 hover:bg-blue-800 md:w-1/3  py-2 px-4 rounded w-full h-16 semibold tracking-wider text-sm semibold"
        >
          Continuar a envios
        </button>
      </div>
    </form>
  );
};

export default InformationForm;
